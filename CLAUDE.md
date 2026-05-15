# CLAUDE.md — Bruce Household AI

Read this before doing anything. Source of truth for all implementation decisions.

---

## What Bruce Is

Private household AI for the Johnson family at heybruce.app. Jake runs the build. Members: Jake (36, admin), Laurianne (33), Jocelynn (16), Nana (69). Kids with no accounts: Elliot (8), Henry (5), Violette (5). Not a product — infrastructure built to behave like a trusted family presence.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript |
| Hosting | Vercel — auto-deploy from GitHub main |
| Database | Supabase (Postgres + RLS + Realtime) |
| Auth | Supabase Auth + Google OAuth |
| AI | Anthropic — claude-sonnet-4-6 |
| Image generation | Replicate (flux-schnell) |
| Web search | Perplexity API |
| URL fetching | Jina Reader |
| Push notifications | Firebase Cloud Messaging |
| Background jobs | DigitalOcean droplet + PM2 |
| Domain | heybruce.app |

---

## Database Schema

Migrations 001–018 applied. `schema.sql` is the source of truth — always update it when altering structure.

**household** — single row; `memories` (jsonb), `context` (jsonb with family member data)

**users** — one per member; `id` (auth.users FK), `email`, `name`, `avatar_url`, `role` (admin|member), `status` (active|suspended|deactivated), `morning_summary_time`, `notification_sensitivity`, `notification_preferences` (jsonb), `fcm_token`, `google_access_token`, `google_refresh_token`, `google_token_expires_at`, `google_drive_root_id`, `google_drive_personal_id`, `google_drive_projects_id`, `color_hex`, `home_location`, `preferred_model`, `deactivated_at`, `purge_at`

**invite_tokens** — single-use 48hr links; `token`, `created_by`, `email`, `role`, `used`, `expires_at`

**projects** — `id`, `owner_id`, `name`, `icon`, `instructions`, `isolate_memory` (bool, default false), `status` (active|archived)

**project_members** — `project_id`, `user_id`, `role` (owner|member)

**chats** — `id`, `owner_id`, `project_id` (null = standalone), `type` (private|group|family|family_group|family_thread|incognito), `title`, `is_incognito`, `deleted_at` (soft-delete for threads), `last_message_at`

**chat_members** — `chat_id`, `user_id`; used for group/family/thread chats only

**messages** — `id`, `chat_id`, `sender_id` (null = Bruce), `role` (user|assistant|system), `content`, `metadata` (jsonb), `image_url`, `attachment_type`, `attachment_filename`

**files** — `project_id`, `owner_id`, `google_drive_file_id`, `name`, `mime_type`, `drive_url`

**memory** — `id`, `type` (private|shared), `owner_id` (private only), `member_combination` (shared only — sorted UUIDs joined `:`), `project_id` (project-isolated only), `content`, `tier` (core|active|archive), `relevance_score`, `category`, `last_accessed`

**notifications** — `user_id`, `type`, `content`, `metadata` (jsonb), `read`, `chat_id`, `read_at`

**pending_memory** — `suggested_by`, `content`, `status` (pending|approved|rejected)

**user_presence** — `user_id` + `chat_id` composite PK, `updated_at`; no user-facing RLS, service role only

**RLS** is enabled on every table. `is_admin()` bypasses it for: `household`, `users`, `invite_tokens`, `pending_memory`. Admin does NOT bypass RLS on: `projects`, `project_members`, `chats`, `chat_members`, `messages`, `files`, `memory`. Memory privacy is architectural — no admin content access.

---

## Active Tools

All three chat routes include the same tool set.

**web_search** — Perplexity API. Tool defined in `lib/searchTools.ts`. Used for current events, live data, anything past knowledge cutoff. System block: `SEARCH_SYSTEM_BLOCK` in `lib/searchTools.ts`.

**browse_url** — Jina Reader. Defined in `lib/searchTools.ts`. Fetches any public URL as clean markdown. Only visit URLs the user explicitly provides. System block: `BROWSE_SYSTEM_BLOCK`.

**generate_image** — Replicate flux-schnell. Not a standard tool — Bruce emits `<image_request>{"prompt":"...","quality":"standard|hd"}</image_request>` as XML in its text response. `app/api/chat/route.ts` intercepts the tag, strips it from the stream, and sends a `IMAGE_REQ:` sentinel to the client, which then calls the image endpoint. Defined via `IMAGE_SYSTEM_BLOCK` in `lib/anthropic/index.ts`. Standalone chat only.

**Google Calendar** — `lib/google/calendarTools.ts`. Read/create/update/delete/respond to events. System block: `CALENDAR_SYSTEM_BLOCK`.

**Gmail** — `lib/google/gmailTools.ts`. Read/send/archive/delete. Three-tier confirmation rules per operation. System block: `GMAIL_SYSTEM_BLOCK`.

**Media analysis** — Bruce reads PDFs and analyzes images. Defined via `IMAGE_VISION_BLOCK` in `lib/anthropic/index.ts`. All contexts.

---

## System Prompt Builders

All in `lib/anthropic/index.ts`.

**Shared constants:** `LAYER_IDENTITY`, `LAYER_HOUSEHOLD` — used by all three builders. `buildMemberLayer(userName, userTimestamp, memoryBlock)` adds per-session context: who is speaking, per-member tone instruction, timestamp, and memory block.

**buildSystemPrompt(userName, memoryBlock, userTimestamp)** — standalone chat. Identity + household + member layer + formatting guidance (prefer lists, max 2-col tables, avoid wide tables).

**buildProjectSystemPrompt(userName, memoryBlock, userTimestamp, project)** — project chat. Adds project block (name, instructions, members, files, Drive content). Single-member: same formatting as standalone. Multi-member: adds participation rule + plain prose only (no markdown).

**buildFamilyChatSystemPrompt(senderName, memoryBlock, userTimestamp)** — family/group chat. Adds participation rule, plain prose only, three-tier stakes rule, tone guidelines.

Route handlers append tool system blocks after the builder output: `CALENDAR_SYSTEM_BLOCK`, `GMAIL_SYSTEM_BLOCK`, `SEARCH_SYSTEM_BLOCK`, `BROWSE_SYSTEM_BLOCK`. Standalone also gets `IMAGE_SYSTEM_BLOCK`. All contexts get `IMAGE_VISION_BLOCK`.

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
| Top bar shell (back/title/right slot) | `components/chat/ChatTopBar.tsx` |
| Server stream + tools + persistence | `lib/chat/streamHandler.ts` |
| Client stream consumer (flush, abort, image-req) | `lib/chat/clientStream.ts` |
| Memory generation on unmount | `lib/chat/useChatMemory.ts` |
| Sender display name + color resolution | `lib/chat/senderProfile.ts` |

**CHAT UI RULE:** Visual changes (bubble styling, list layout, input bar, top bar layout, dots, indicators) must always be made in the shared components above, never in the context wrappers. Context variations are handled via props — never by forking a component.

**MESSAGE MAPPING RULE:** All message field mapping from raw Supabase rows or realtime payloads goes through `normalizeMessage()` in `lib/chat/normalizeMessage.ts`. Never build a `Message` / `NormalizedMessage` object from raw DB data inline in a component, subscription handler, or page loader — call `normalizeMessage(row)` and consume the typed result. Shared chat types (`NormalizedMessage`, `ChatMessage`, `MessageAttachment`) live in `lib/chat/types.ts`.

**SYSTEM PROMPT RULE:** All system prompt construction goes through `buildSystemPrompt()` in `lib/chat/buildSystemPrompt.ts`. Routes pass a `SystemPromptContext` (mode, user, memory, location, project metadata, dev extras) — they do not concatenate prompt strings, append tool blocks, or assemble identity/household/member layers themselves. Bruce's core identity, household context, formatting rules, participation rule, and three-tier rule are written once inside `buildSystemPrompt`.

**Streaming model:** the server emits one consolidated assistant message per turn even when tools interleave (no per-turn DB rows). The client consumes the stream through `consumeStream()` with a 24ms flush tick so partial markdown renders progressively. An `AbortController` from `ChatWindow`/`ProjectChatView`/`FamilyChatWindow` is passed both to `fetch` and `consumeStream` — pressing Stop in `MessageInput` cancels both, preserves whatever text has been emitted, and marks any in-flight task steps as cancelled.

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

Phase 6 complete: image generation, web search, browse_url, mobile UI fixes, family thread navigation, admin memory panel.
Phase 6 planned: user-facing chat deletion, "continue in group chat" feature.
