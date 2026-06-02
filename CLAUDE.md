# CLAUDE.md — Bruce Household AI

Read this before doing anything. Source of truth for all implementation decisions.

---

## What Bruce Is

Private household AI for the Johnson family at heybruce.app. Jake runs the build. Members: Jake (36, admin), Laurianne (33), Jocelynn (16), Nana (69), Grampy (new — mutually excluded from Nana). Kids with no accounts: Elliot (8), Henry (5), Violette (5). Not a product — infrastructure built to behave like a trusted family presence.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript |
| Hosting | Vercel — auto-deploy from GitHub main |
| Database | Supabase (Postgres + RLS + Realtime) |
| Auth | Supabase Auth + Google OAuth |
| AI | Anthropic — claude-sonnet-4-6 |
| Image generation | fal.ai (FLUX.1 — flux/dev + flux-pro/v1.1) |
| Web search | Anthropic native web search (server tool) |
| URL fetching | Jina Reader |
| Push notifications | Firebase Cloud Messaging |
| Background jobs | DigitalOcean droplet + PM2; Vercel native cron |
| Domain | heybruce.app |

---

## Database Schema

Migrations 001–030 applied; 031 pending Supabase SQL editor. `schema.sql` is the source of truth — always update it when altering structure.

**household** — single row; `memories` (jsonb), `context` (jsonb with family member data)

**users** — one per member; `id` (auth.users FK), `email`, `name`, `avatar_url`, `role` (admin|member), `status` (active|suspended|deactivated), `morning_summary_time`, `notification_sensitivity`, `notification_preferences` (jsonb), `fcm_token` (legacy — superseded by `user_fcm_tokens`), `google_access_token`, `google_refresh_token`, `google_token_expires_at`, `google_drive_root_id`, `google_drive_personal_id`, `google_drive_projects_id`, `color_hex`, `home_location`, `preferred_model`, `deactivated_at`, `purge_at`

**invite_tokens** — single-use 48hr links; `token`, `created_by`, `email`, `role`, `used`, `expires_at`

**projects** — `id`, `owner_id`, `name`, `icon`, `instructions`, `isolate_memory` (bool, default false), `status` (active|archived)

**project_members** — `project_id`, `user_id`, `role` (owner|member)

**chats** — `id`, `owner_id`, `project_id` (null = standalone), `type` (private|group|family|family_group|family_thread|incognito), `title`, `is_incognito`, `deleted_at` (soft-delete for threads), `last_message_at`

**chat_members** — `chat_id`, `user_id`, `last_read_at` (nullable — per-member read marker powering unread dots, migration 024); used for group/family/thread chats only

**messages** — `id`, `chat_id`, `sender_id` (null = Bruce), `role` (user|assistant|system), `content`, `metadata` (jsonb), `image_url`, `attachment_type`, `attachment_filename`, `file_ids` (jsonb — Anthropic Files API IDs for context-efficient history replay, migration 021)

**files** — `project_id`, `owner_id`, `google_drive_file_id`, `name`, `mime_type`, `drive_url`

**memory** — `id`, `type` (private|shared), `owner_id` (private only), `member_combination` (shared only — sorted UUIDs joined `:`), `project_id` (project-isolated only), `content`, `tier` (core|active|archive), `relevance_score`, `category`, `last_accessed`

**notifications** — `user_id`, `type`, `content`, `metadata` (jsonb), `read`, `chat_id`, `read_at`

**pending_memory** — `suggested_by`, `content`, `status` (pending|approved|rejected)

**user_presence** — `user_id` + `chat_id` composite PK, `updated_at`; no user-facing RLS, service role only

**admin_dev_sessions** — named sessions for the Bruce Dev admin workspace; `id`, `name`, `created_at`, `updated_at`. No RLS, service role only.

**admin_dev_messages** — persistent history for the Bruce Dev workspace; `id`, `session_id` (FK → admin_dev_sessions), `role`, `content`, `created_at`. No RLS, service role only.

**system_config** — runtime-mutable key/value store for config that can't live in env vars (e.g. OAuth tokens refreshed via admin UI); PK on `key TEXT`. RLS: admin read only, service-role writes.

**user_fcm_tokens** — multi-device FCM token table (migration 026) replacing single `users.fcm_token`. `id`, `user_id`, `token` (UNIQUE), `device_hint`, `created_at`, `last_seen_at`. RLS enabled, service role only. `notifyUser()` fans out to all tokens; stale tokens (FCM 404) are auto-deleted.

**reminders** — personal reminders managed via the `manage_reminders` tool; `id`, `user_id`, `content`, `remind_at`, `completed_at`, `notified_at`, `chat_id` (FK → chats ON DELETE SET NULL — used for FCM deep-link). RLS: users manage own rows.

**reactions** — thumbs-up reactions on messages; `id`, `message_id` (FK → messages CASCADE), `chat_id` (FK → chats CASCADE, denormalized for realtime filtering), `user_id` (FK → users, nullable — NULL = Bruce), `type` (text, default `thumbs_up`), `created_at`. Partial unique indexes: one Bruce reaction per message per type; one member reaction per message per user per type. RLS: read via `is_chat_member(chat_id)`, insert/delete own only. Service role for Bruce reactions.

**member_exclusions** — mutual exclusion pairs preventing two members from sharing a chat or project (migration 031); `id`, `user_id_a` (FK → users CASCADE), `user_id_b` (FK → users CASCADE), `created_by` (FK → users), `created_at`. Unique expression index on `(LEAST, GREATEST)` of the UUID pair. Admin-only RLS. DB triggers on `chat_members` and `project_members` enforce exclusions at insert time — raise `member_exclusion_violation` which API routes catch and return 409. `getExcludedMemberIds(userId)` in `lib/members/` fetches via service role for the UI layer.

**RLS** is enabled on every table. `is_admin()` bypasses it for: `household`, `users`, `invite_tokens`, `pending_memory`. Admin does NOT bypass RLS on: `projects`, `project_members`, `chats`, `chat_members`, `messages`, `files`, `memory`. Memory privacy is architectural — no admin content access.

---

## Active Tools

All chat routes use the same tool set. Tool definitions live in `lib/`. System blocks are assembled by `buildToolSystemBlocks()` in `lib/chat/streamHandler.ts` and appended to the system prompt.

**web_search** — Anthropic native web search **server tool** (`{ type: "web_search_20260209", name: "web_search" }`, exported as `WEB_SEARCH_TOOL` from `lib/searchTools.ts`, added to `TOOLS_FULL` on every request). Anthropic runs the search server-side and streams `server_tool_use` + `web_search_tool_result` blocks back inside the same assistant turn — there is **no client-side dispatch**. `streamHandler` detects the `server_tool_use` content-block-start to emit the "Searching the web…" status. Used for current events, live data, anything past knowledge cutoff. System block: `SEARCH_SYSTEM_BLOCK`.

**browse_url** — Jina Reader. Defined in `lib/searchTools.ts`. Fetches any public URL as clean markdown. Only visit URLs the user explicitly provides. System block: `BROWSE_SYSTEM_BLOCK`.

**search_chat_history** — Full-text search of persisted message history via `messages_content_fts_idx` GIN index (migration 029). Defined in `lib/searchTools.ts`. Scoped to the current project when in project context. System block: `HISTORY_SEARCH_SYSTEM_BLOCK`. All contexts.

**generate_image** — fal.ai FLUX.1. Not a standard tool — Bruce emits `<image_request>{"prompt":"...","quality":"standard|hd"}</image_request>` as XML in its text response. `app/api/chat/route.ts` intercepts the tag, strips it from the stream, and sends an `IMAGE_REQ:` sentinel to the client, which then calls the image endpoint. The single image module is `lib/image/generateImage.ts` (`generateImage({ prompt, model?, imageSize? }) → { url }`); `quality` maps standard→`fal-ai/flux/dev`, hd→`fal-ai/flux-pro/v1.1`. `lib/images/generate.ts` (`generateImageAndSave`) calls it, then persists to Drive + DB. No polling/cold start. Requires `FAL_KEY`. Defined via `IMAGE_SYSTEM_BLOCK` in `lib/anthropic/index.ts`. Standalone and single-member project chats only.

**Google Calendar** — `lib/google/calendarTools.ts`. Read/create/update/delete/respond to events. System block: `CALENDAR_SYSTEM_BLOCK`.

**Gmail** — `lib/google/gmailTools.ts`. Read/send/archive/delete. Three-tier confirmation rules per operation. System block: `GMAIL_SYSTEM_BLOCK`.

**manage_reminders** — `lib/remindersTools.ts`. Create, list, complete, and snooze personal reminders. Low-stakes: create immediately with brief acknowledgment, no confirmation needed. System block: `REMINDERS_SYSTEM_BLOCK`. All contexts.

**Document tools** — `lib/documents/documentTools.ts`. Read spreadsheets, CSVs, and Drive files; resolve paths; list directory contents. System block: `DOCUMENT_SYSTEM_BLOCK`. All contexts.

**Media analysis** — Bruce reads PDFs and analyzes images. Defined via `IMAGE_VISION_BLOCK` in `lib/anthropic/index.ts`. All contexts.

**Multi-step task progress** — For tasks with 3+ sequential tool calls, Bruce emits `<task_progress>` XML blocks that render as live progress cards on the client. No intermediate text or calculations during tool execution — only the task card and a brief final summary. Defined via `TASK_PROGRESS_SYSTEM_BLOCK` in `lib/anthropic/index.ts`. All contexts.

**Market intelligence layer** — `MARKET_INTELLIGENCE` constant in `lib/chat/buildSystemPrompt.ts`, injected into the system prompt for all non-dev contexts. Instructs Bruce to always run a current web search before answering on AI industry, technology market, or financial topics — training data is treated as background only. Preferred sources: Bloomberg, FT, WSJ, Reuters Technology, Stratechery, The Information, SEC EDGAR. Tracks hyperscaler capex, datacenter infrastructure, energy, semiconductors, and related sectors.

---

## Background Infrastructure

**Vercel native cron — reminders:** `GET /api/cron/reminders`, scheduled `"* * * * *"` (every minute) in `vercel.json`. Vercel injects `Authorization: Bearer <CRON_SECRET>` in production. Handler finds reminders where `remind_at <= now`, `notified_at IS NULL`, and `completed_at IS NULL`; fires FCM to all of the user's tokens in `user_fcm_tokens`; sets `notified_at = now()`. Deep-link URL uses `reminders.chat_id` when set.

**DigitalOcean droplet + PM2:** long-running background jobs not suited to serverless (e.g. Google Drive sync, morning summary generation).

---

## System Prompt Builders

**Single entry point:** `buildSystemPrompt(ctx: SystemPromptContext)` in `lib/chat/buildSystemPrompt.ts`. Routes pass a `SystemPromptContext` and get back the full prompt string — they never assemble prompt fragments, append tool blocks, or concatenate identity/household/member layers themselves.

**Shared constants** exported from `lib/anthropic/index.ts` and imported by `buildSystemPrompt.ts`:
- `LAYER_IDENTITY` — Bruce's character and core identity
- `LAYER_HOUSEHOLD` — Johnson family member list and context
- `buildMemberLayer(userName, userTimestamp, memoryBlock)` — adds who is speaking, per-member tone instruction, timestamp, and assembled memory block

**Mode discriminator:** `SystemPromptContext.mode` is `"standalone" | "project" | "family" | "dev"`. Layer order per mode:

- **standalone:** `LAYER_IDENTITY` → `LAYER_HOUSEHOLD` → `memberLayer` → `MARKET_INTELLIGENCE` → `chatContext` (SOLO_FORMAT — prefer lists, max 2-col tables, avoid wide tables)
- **project (single-member):** same as standalone plus a project block (name, instructions, members, files, Drive content)
- **project (group):** same plus MULTI_MEMBER_PARTICIPATION_RULE and GROUP_FORMAT instead of SOLO_FORMAT
- **family:** `LAYER_IDENTITY` → `LAYER_HOUSEHOLD` → `memberLayer` → `MARKET_INTELLIGENCE` → `chatContext` (MULTI_MEMBER_PARTICIPATION_RULE + GROUP_FORMAT + FAMILY_THREE_TIER)
- **dev:** `LAYER_IDENTITY` → `LAYER_HOUSEHOLD` → `memberLayer` → `extraSections[]`. No MARKET_INTELLIGENCE, no tool blocks.

After the core layers, `buildSystemPrompt` appends optional context injected by the route:
- `locationContext` — per-route location sentence
- `remindersContext` — upcoming reminders block for passive awareness (queried live from DB)

Tool system blocks are appended last via `buildToolSystemBlocks(opts)` from `lib/chat/streamHandler.ts`: `CALENDAR_SYSTEM_BLOCK`, `GMAIL_SYSTEM_BLOCK`, `REMINDERS_SYSTEM_BLOCK`, `IMAGE_SYSTEM_BLOCK` (standalone + single-member project only), `IMAGE_VISION_BLOCK`, `SEARCH_SYSTEM_BLOCK`, `BROWSE_SYSTEM_BLOCK`, `HISTORY_SEARCH_SYSTEM_BLOCK`, `DOCUMENT_SYSTEM_BLOCK`, `TASK_PROGRESS_SYSTEM_BLOCK`.

---

## Memory Architecture

Two types: **private** (one member + Bruce) and **shared** (multiple members). All assembly uses the service role client — RLS gates client reads but assembly bypasses it server-side.

**Private:** `owner_id` set, `member_combination` null. Generated from standalone and single-member project chats.

**Shared:** `owner_id` null, `member_combination` = alphabetically sorted UUIDs joined `:`. Generated from family chats and multi-member project chats.

**Project isolation:** `projects.isolate_memory` (default false). When true, new shared memories from that project are tagged with `project_id` and excluded from the global combination stream. The global stream still loads inside isolated projects (flow in, not out). Toggle lives on the project right panel — owners only.

**Loading order:** private core (max 20) → private active (max 15 by relevance score) → global shared core → global shared active → project-isolated core/active (if `isolate_memory` on). Budget: 500 words. Relevance scores incremented on every load.

**Generation:** `app/api/memory/generate/route.ts` — called with `keepalive: true` on component unmount. Sends conversation to Claude, generates a memory entry. Determines type (private vs shared) from chat type and member count.

**Admin access:** `/admin/memory` shows aggregate counts per member via `get_memory_metrics()` (SECURITY DEFINER function, migration 018). No content access ever.

---

## Chat Architecture

All three chat contexts (standalone, project, family) share the same code paths. Context wrappers (`ChatWindow`, `ProjectChatView`, `FamilyChatWindow`) assemble per-context data and callbacks; visual rendering, streaming, persistence, and memory generation are shared.

| Concern | Shared module |
|---|---|
| Bubble rendering | `components/chat/MessageBubble.tsx` |
| Message list | `components/chat/MessageList.tsx` |
| Input bar (send/stop/attach) | `components/chat/MessageInput.tsx` |
| Input "+" menu (attach + move-to-project) | `components/chat/InputPlusMenu.tsx` |
| Project picker list (icon + name + member pips) | `components/chat/ProjectPickerList.tsx` |
| Top bar shell (back/title/right slot) | `components/chat/ChatTopBar.tsx` |
| Server stream + tools + persistence | `lib/chat/streamHandler.ts` |
| Client stream consumer + finalizer (flush, abort, image-req, final text/task) | `lib/chat/clientStream.ts` |
| Memory generation on unmount | `lib/chat/useChatMemory.ts` |
| Reaction state (initial seed, post-stream reload, optimistic toggle) | `hooks/useChatReactions.ts` |
| Per-chat session (device location, mark-read, delete message, retry) | `hooks/useChatSession.ts` |
| Sender display name + color resolution | `lib/chat/senderProfile.ts` |

**CHAT UI RULE:** Visual changes (bubble styling, list layout, input bar, top bar layout, dots, indicators) must always be made in the shared components above, never in the context wrappers. Context variations are handled via props — never by forking a component.

**CHAT LOGIC RULE:** Cross-context chat behavior lives in shared hooks, never duplicated in the wrappers. `useChatReactions(chatId, currentUserId, userColorHex, colorMap, initialReactions)` owns the `reactionsMap` and returns `{ reactionsMap, setReactionsMap, loadReactions, handleReact }` — `setReactionsMap` is exposed so the project/family realtime subscriptions can apply INSERT/DELETE events into the same state. `useChatSession({ chatId, currentUserId, messages, setMessages, setInput, setError })` owns device-location lookup, the `/api/chats/mark-read` on-open call, `deleteMessage`, and `handleRetry`. Context-specific concerns stay in the wrapper (e.g. family's `/api/notifications/mark-read` + presence heartbeat, project's instructions-on-unmount, the per-context realtime channels and message subscriptions).

**Move to project:** Standalone private chats the viewer owns can be moved into a project from the input bar. `MessageInput` renders the shared `InputPlusMenu` (the "+" button) in every context; it shows "Attach file" plus — only when a `moveToProject` config is passed — a "Move to project" entry. Desktop opens an inline flyout, mobile a second-level bottom sheet, both rendering the shared `ProjectPickerList`. Eligibility (`canMoveToProject`, computed in `app/chat/[id]/page.tsx` as `type === 'private' && owner === viewer`) and the move handler live in `ChatWindow`; the move is `PATCH /api/chats/[id]/move` ({ projectId }), gated by RLS (owner + project membership). On success `ChatWindow` sets a local `projectContext` (topbar shows a `[Project] / [Chat]` breadcrumb via `TopBar`'s `projectName` prop, and the menu entry disappears) and calls `refreshChats()` so the sidebar drops the chat from the standalone list. The picker's project list comes from `GET /api/projects/movable` (RLS-gated project visibility; member pips resolved via service role since `users` RLS is own-row-only).

**MESSAGE MAPPING RULE:** All message field mapping from raw Supabase rows or realtime payloads goes through `normalizeMessage()` in `lib/chat/normalizeMessage.ts`. Never build a `Message` / `NormalizedMessage` object from raw DB data inline in a component, subscription handler, or page loader — call `normalizeMessage(row)` and consume the typed result. Shared chat types (`NormalizedMessage`, `ChatMessage`, `MessageAttachment`) live in `lib/chat/types.ts`.

**SYSTEM PROMPT RULE:** All system prompt construction goes through `buildSystemPrompt()` in `lib/chat/buildSystemPrompt.ts`. Routes pass a `SystemPromptContext` (mode, user, memory, location, project metadata, dev extras) — they do not concatenate prompt strings, append tool blocks, or assemble identity/household/member layers themselves. Bruce's core identity, household context, formatting rules, participation rule, and three-tier rule are written once inside `buildSystemPrompt`.

**Streaming model:** the server emits one consolidated assistant message per turn even when tools interleave (no per-turn DB rows). The client consumes the stream through `consumeStream()` with a RAF flush tick so partial markdown renders progressively. An `AbortController` from `ChatWindow`/`ProjectChatView`/`FamilyChatWindow` is passed both to `fetch` and `consumeStream` — pressing Stop in `MessageInput` cancels both, preserves whatever text has been emitted, and marks any in-flight task steps as cancelled.

**STREAM FINALIZER RULE:** When a stream completes, every context computes the final user-visible text and task-progress data through the single `finalizeStream(accumulated)` helper in `lib/chat/clientStream.ts` — never by re-implementing the sentinel/tag stripping inline. `finalizeStream` reuses `parseStreamFrame`'s canonical stripping (task XML tags incl. unclosed, `STATUS` sentinels, `TASK_PROGRESS` sentinels, `image_request` blocks, `\x1f` IMAGE_REQ terminator). All four contexts (`ChatWindow`, `ProjectChatView`, `FamilyChatWindow`, `NewChatOrchestrator`) call it; inline copies had previously drifted (project chat flashed raw `TASK_PROGRESS` sentinels; family chat leaked `STATUS` sentinels).

**Streaming status indicator:** the "Searching the web…"/working-status strip is rendered once, in the shared `MessageList` (driven by its `streamingStatus` prop), so it appears identically in standalone, project, and family chat. It is NOT a top-bar concern — `TopBar` no longer carries a `statusText` prop, and `MessageBubble` does not render status.

**Unread indicators:** `chat_members.last_read_at` (migration 024) is updated to `now()` whenever a chat is opened via `POST /api/chats/mark-read`. The sidebar queries `chat_members` on mount and renders an 8px `#0F6E56` dot when `chats.last_message_at > last_read_at` and the latest message wasn't sent by the current user.

## Build Conventions

- **Model:** always `claude-sonnet-4-6`. Never hardcode another.
- **Streaming:** all chat responses stream via Anthropic SDK streaming helpers.
- **No `any` types.** Use `lib/types.ts`.
- **API keys never leave the server.** API routes and DigitalOcean jobs only.
- **RLS is the privacy wall.** Never bypass on the client. Service role: server-side only.
- **Incognito messages never touch the database.**
- **No console.log in production paths.**
- **Design tokens only.** `app/globals.css` has all tokens. Accent: `#0F6E56`. No Tailwind.
- **Mobile-first.** Every component must work on iPhone.
- **Deploy:** git push to main. Vercel auto-deploys. Never `npx vercel --prod`.
- **Schema changes:** update `schema.sql` and provide a numbered migration file in `migrations/`.
- **Migrations are manual:** apply in the Supabase SQL editor immediately after push. App will 500 until applied. Log completion in `docs/migration-log.md`.
- **Working tree must be clean before ending a session.** Run `git status` to confirm.

**USER PROFILE RULE:** All fetches from the `users` table that supply data to the chat UI must go through `getUserProfile()` in `lib/user/getUserProfile.ts`. Never add a new inline `.select()` from `users` in a page or component — add the column to `getUserProfile()` and it propagates everywhere.

**Supabase client pattern:**
```typescript
// Client component
import { createClient } from "@/lib/supabase/client";

// Server component or API route
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();

// Bypass RLS (server-side only)
import { createServiceRoleClient } from "@/lib/supabase/server";
```

---

## Decisions Log

Full decisions log: `docs/decisions.md` (injected into the Bruce Dev workspace prompt automatically via `loadDecisionsLog()`). Add entries there for any significant architectural or product decision. Entries are in reverse-chronological order.

Summary of key decisions recorded:

**Memory architecture (2026-05-09):** Two types — private (owner_id) and shared (member_combination). Shared is scoped to sorted UUID pairs, not containers. Project isolation toggle keeps new memories inside a project. Admin has no content access — metrics only via SECURITY DEFINER function.

**RLS admin overrides removed (2026-05-06, migration 016):** Stripped `is_admin()` from projects, project_members, chats, messages, files. Admin bypass retained only for household, users, invite_tokens, pending_memory.

---

## Phase Status

| Phase | Status |
|---|---|
| 1 — Foundation | ✅ Complete |
| 2 — Core Chat | ✅ Complete |
| 3 — Projects | ✅ Complete |
| 4 — Household | ✅ Complete |
| 5 — Connectors + Admin | ✅ Complete (2026-05-01) |
| 6 — Polish | 🔄 In progress |

Phase 6 complete: image generation, web search, browse_url, mobile UI fixes, family thread navigation, admin memory panel, unread dot indicators, TASK_PROGRESS system (multi-step task cards), document tools (Sheets/Docs/Drive), search_chat_history + full-text search index, manage_reminders tool + FCM delivery + Vercel cron, multi-device FCM (user_fcm_tokens), Group Chat Awareness (unified participation rule), Settings page (tab layout, desktop panel, Back button), PWA icon refresh (all slots, iOS apple-touch-icon versioning), MARKET_INTELLIGENCE research layer.

Phase 6 planned: user-facing chat deletion, "continue in group chat" feature.
