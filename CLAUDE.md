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
| Shared browser | Browserbase (Live View iframe) + playwright-core CDP (server-side control) |
| Web search | Anthropic native web search (server tool) |
| URL fetching | Jina Reader |
| Push notifications | Firebase Cloud Messaging |
| Background jobs | DigitalOcean droplet + PM2; Vercel native cron |
| Domain | heybruce.app |

---

## Database Schema

Migrations 001–034 applied; **035 pending Supabase SQL editor** (scheduled_tasks). `schema.sql` is the source of truth — always update it when altering structure.

**household** — single row; `memories` (jsonb), `context` (jsonb with family member data)

**users** — one per member; `id` (auth.users FK), `email`, `name`, `avatar_url`, `role` (admin|member), `status` (active|suspended|deactivated), `morning_summary_time`, `notification_sensitivity`, `notification_preferences` (jsonb), `fcm_token` (legacy — superseded by `user_fcm_tokens`), `google_access_token`, `google_refresh_token`, `google_token_expires_at`, `google_drive_root_id`, `google_drive_personal_id`, `google_drive_projects_id`, `color_hex`, `home_location`, `preferred_model`, `preferred_effort` (effort level; null = model default — migration 036), `deactivated_at`, `purge_at`

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

**browser_sessions** — shared inline browser (migration 033); one active Browserbase session per chat. `id`, `chat_id` (FK → chats CASCADE), `browserbase_session_id`, `live_view_url` (Browserbase `debuggerFullscreenUrl`), `current_url` (default `about:blank`, synced on every action), `created_by` (FK → users SET NULL), `is_active`, `created_at`, `ended_at`. Partial index on `(chat_id, is_active) WHERE is_active`. On the realtime publication so the panel's address bar syncs across members. RLS: chat owner or any `chat_members` row. Service-role writes from API routes after membership check. Requires `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`.

**scheduled_tasks** — proactive standing tasks (migration 035); `id`, `user_id` (FK → users CASCADE), `chat_id` (FK → chats CASCADE — target chat, must be one the owner belongs to), `prompt`, `schedule` (jsonb: `{type: daily|weekly|monthly, time: "HH:MM", weekday?, day?}`), `timezone`, `next_run_at` (precomputed UTC, partial index WHERE enabled), `enabled`, `last_run_at`, `last_error`, `created_at`. RLS: users manage own rows; cron dispatcher uses service role. Privacy rule: a task runs as its owner and can never see or post anything the owner couldn't by hand.

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

**manage_scheduled_tasks** — `lib/scheduledTasks/tools.ts`. Create/list/update/delete standing tasks (recurring Bruce runs that post into the current chat — morning briefings, weekly summaries). Schedule math lives in `lib/scheduledTasks/schedule.ts` (pure, unit-tested — structured recurrence, no cron-expression parsing; `computeNextRunAt` is timezone- and DST-aware). System block: `SCHEDULED_TASKS_SYSTEM_BLOCK`. Not available in incognito (errors on null chatId). All non-incognito contexts.

**Document tools** — `lib/documents/documentTools.ts`. Read spreadsheets, CSVs, and Drive files; resolve paths; list directory contents. System block: `DOCUMENT_SYSTEM_BLOCK`. All contexts.

**browse_page** — shared inline browser. Tool def + `BROWSER_SYSTEM_BLOCK` live in `lib/browser/browseTool.ts`. Actions: `navigate` | `act` | `extract` | `screenshot`. Bruce drives a Browserbase session server-side (`lib/browser/stagehand.ts`, `performBrowserAction`) by connecting to the **existing** session over CDP with `playwright-core` (`chromium.connectOverCDP` using the signed `connect_url` captured at create time — never creates its own session; Stagehand's v3.5 `browserbaseSessionID` reconnect was unreliable so it was replaced with a direct CDP connect). `navigate` + `screenshot` are live; `act`/`extract` are stubbed for now. Household members watch + interact via the Browserbase Live View iframe (`components/browser/BrowserPanel.tsx`). One session per chat, persisted in `browser_sessions` (`lib/browser/browserbase.ts`). Unlike other tools, `browse_page` is executed specially inside `runChatStream` (`executeBrowsePage`) so it can emit a `\x1eBROWSER_EVENT:{…}\x1e` sentinel that opens the panel the instant Bruce starts working; the client parses it in `parseStreamFrame` → `tick.browserEvent` and feeds the shared `useBrowserPanel` hook. URL bar syncs across members via Realtime on `browser_sessions.current_url`. Not available in incognito (globe button hidden; tool errors on null chatId). All non-incognito contexts. Routes inject the active-session note via `getBrowserContextBlock(chatId)` → `SystemPromptContext.browserContext`. API: `app/api/browser/session/route.ts` (POST create / DELETE release), `app/api/browser/action/route.ts` (human-side navigate). Requires `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`.

**Media analysis** — Bruce reads PDFs and analyzes images. Defined via `IMAGE_VISION_BLOCK` in `lib/anthropic/index.ts`. All contexts.

**Multi-step task progress** — For tasks with 3+ sequential tool calls, Bruce emits `<task_progress>` XML blocks that render as live progress cards on the client. No intermediate text or calculations during tool execution — only the task card and a brief final summary. Defined via `TASK_PROGRESS_SYSTEM_BLOCK` in `lib/anthropic/index.ts`. All contexts.

**Market intelligence layer** — `MARKET_INTELLIGENCE` constant in `lib/chat/buildSystemPrompt.ts`, injected into the system prompt for all non-dev contexts. Instructs Bruce to always run a current web search before answering on AI industry, technology market, or financial topics — training data is treated as background only. Preferred sources: Bloomberg, FT, WSJ, Reuters Technology, Stratechery, The Information, SEC EDGAR. Tracks hyperscaler capex, datacenter infrastructure, energy, semiconductors, and related sectors.

---

## Background Infrastructure

**Vercel native cron — reminders:** `GET /api/cron/reminders`, scheduled `"* * * * *"` (every minute) in `vercel.json`. Vercel injects `Authorization: Bearer <CRON_SECRET>` in production. Handler finds reminders where `remind_at <= now`, `notified_at IS NULL`, and `completed_at IS NULL`; fires FCM to all of the user's tokens in `user_fcm_tokens`; sets `notified_at = now()`. Deep-link URL uses `reminders.chat_id` when set.

**Vercel native cron — scheduled tasks:** `GET /api/cron/scheduled-tasks`, scheduled `"*/5 * * * *"` in `vercel.json` (maxDuration 300). Finds due `scheduled_tasks` (enabled, `next_run_at <= now`, max 5 per invocation, sequential), **claims each before running** by advancing `next_run_at` conditioned on the read value (overlapping invocations can't double-fire), then executes a full Bruce turn server-side as the task's owner by draining `runChatStream` — same persistence, tool traces, and prompt caching as live chat. Family-type target chats get family mode + shared memory; everything else standalone + private memory. The run injects `scheduledTaskContext` into `buildSystemPrompt` (automated-run preamble). FCM goes to all chat members for family targets, owner only otherwise. Failures write `last_error` and skip to the next occurrence — no retries. Soft-deleted/missing target chats disable the task.

**DigitalOcean droplet + PM2:** long-running background jobs not suited to serverless (e.g. Google Drive sync, morning summary generation).

---

## Native iOS Shell

A Capacitor **remote-URL** shell (`ios/` + `capacitor.config.ts`): a WKWebView pointed at `server.url = https://heybruce.app`. It is not a bundled rewrite — the same web app serves browser and shell. `window.Capacitor` is auto-injected, so web code feature-detects native context via `isNative()` (`lib/native/index.ts`, reads `window.Capacitor?.isNativePlatform?.()`; false in every browser). All native branches are guarded by `isNative()` — web/desktop paths are byte-for-byte unchanged.

**Deploy model:** web changes (UI, logic, tools, prompts) ship via `git push` to main exactly as always — Vercel deploys and the shell picks them up on next load, no rebuild. **Only native-capability changes** (plugins, entitlements, Swift) require an **Xcode rebuild + reinstall to device**.

**Remote-URL gotcha (device-testing branch web code):** because the shell loads the deployed `main` bundle (`server.url`), it **cannot run branch-only web code** — even after an Xcode rebuild, the device runs production until the branch is on `main`. A feature that pairs a native binary change with web code that *calls* it (e.g. the native attach pickers) will look half-broken on device pre-merge: the binary half is present but the web half that invokes it isn't served yet. To device-test branch web code, either point `server.url` at a Vercel **preview** URL *with deployment protection disabled / a bypass token* (protected previews hit a login wall in WKWebView), or merge to `main` and verify on production. The merge-then-verify-on-prod shortcut is acceptable **only** for additive, behind-`isNative()`, shell-only changes — never for RLS/auth/payments/core-data. Never commit a preview `server.url`.

**Native Google OAuth.** Google blocks OAuth inside embedded webviews, so login + connector grants route through `nativeGoogleOAuth()` (`lib/native/oauth.ts`) → the custom **`OAuthPlugin`** (`ios/App/App/OAuthPlugin.swift`), which drives **`ASWebAuthenticationSession`** and intercepts the `https://heybruce.app/auth/native-callback` HTTPS callback directly, returning the URL to JS. The web client's `detectSessionInUrl` then does the single PKCE exchange on `/auth/native-callback`; native-only provider tokens are mirrored to the DB via `POST /api/native/google-tokens` (session-gated, own-row). `OAuthPlugin` is registered via `CAPBridgedPlugin` + `registerPluginInstance` in `MainViewController.capacitorDidLoad()` (Capacitor 8 + SPM no longer auto-discovers app-target plugins). See `docs/oauth-spike.md`.

**Associated Domains.** Requires BOTH `applinks:heybruce.app` (Universal Link callback routing) AND `webcredentials:heybruce.app` (ASWebAuthenticationSession HTTPS callback validation). The AASA at `public/.well-known/apple-app-site-association` carries both an `applinks` and a `webcredentials` key, appID `3ZL5564832.app.heybruce.shell`. Apple's CDN validates webcredentials on-device with a ~6h cache TTL.

**Toolchain.** Capacitor 8 requires Xcode 16+/Swift 6/macOS Sonoma+. Shell development happens on the new Mac (macOS 26.5 / Xcode 26.5). Safe-area handling: `app/layout.tsx` sets `viewport-fit=cover` and the shell `<main>` adds `padding-top: env(safe-area-inset-top)` so content clears the iOS status bar (no-op on web).

**Native plugins & display polish** (`@capacitor/keyboard`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/camera`, `@capacitor/filesystem`; all setup `isNative()`-guarded in `lib/native/`, wired in `ChatShell`):
- **Camera / photo library** (`lib/native/camera.ts`): the `+` sheet's Camera/Photos tiles. On native only, Camera → `Camera.getPhoto` (single), Photos → `Camera.pickImages` (multi-select); both return browser `File`s that converge with the web `<input>` path at `MessageInput.ingestFiles` → the same HEIC/size guards + `processFile` resize (no bypass). **Byte read via Filesystem, NOT fetch (the on-device fix):** `pickImages` returns a `path` (`capacitor://…`/`file://`) — WKWebView **blocks `fetch()` on those URLs** ("Fetch API cannot load … due to access control checks"), so `pickPhotosNative` reads the bytes across the Capacitor bridge with `Filesystem.readFile({ path: p.path ?? p.webPath })` → base64 → `File` (requires **`@capacitor/filesystem`**). `takePhotoNative` uses `resultType: Base64` and never touches fetch/filesystem. **HEIC normalization (kept as a guard):** `ingestFiles` rejects HEIC and Anthropic vision can't read it, so `camera.ts`'s `toJpegFile()` re-encodes any HEIC/HEIF File to JPEG via offscreen `<img>` + canvas (WKWebView decodes HEIC natively; no `heic2any` dep) before it leaves the native layer. In practice the iOS picker reports `format: "jpeg"`, so picked photos sail through `toJpegFile`'s passthrough. Non-HEIC passes through; the desktop path and the `ingestFiles` guard are untouched (iOS converges onto the existing path with valid JPEG bytes). Files stays on the web `<input>`. Requires the three `NS*UsageDescription` Info.plist strings (camera, photo-library read, photo-library add) — absent strings = hard iOS crash; all three are present. `CAPCameraPlugin` + `FilesystemPlugin` auto-register via `capacitor.config.json` `packageClassList` (regenerated by `cap sync`; no `MainViewController` change). **Adding `@capacitor/filesystem` is a native-plugin change → needs `npx cap sync ios` + Xcode rebuild + reinstall, not just `git push`.**
- **Keyboard** (`lib/native/keyboard.ts`): hides the iOS accessory bar and uses `KeyboardResize.None`, driving layout from `keyboardWillShow`/`WillHide` — it sets `--app-height`/`--kb-safe-bottom` so the input leads the keyboard slide (no start-lag) and dispatches `bruce:keyboardshow` so `MessageList` re-pins to the latest message. `useVisualViewportLock` early-returns on native (web/PWA keeps the visual-viewport hack).
- **Status bar** (`lib/native/statusbar.ts`): overlays the webview (header already inset), style follows `prefers-color-scheme`.
- **Splash** (`lib/native/splash.ts` + config): solid `#111111`, hidden on first paint by `NativeSplashGate` (mounted in `RootLayout`) — no white/black flash. `LaunchScreen.storyboard` is a solid `#111111` view (no logo).
- **App icon**: `ios/App/App/Assets.xcassets/AppIcon.appiconset/` — gold B on teal, single-1024 universal config. Source PNG had transparency (iOS rejects alpha); flattened to an opaque teal square (iOS applies its own mask).

**Composer** (web + native): one rounded container, vertical stack — full-width textarea on top, control row below (`+` and model picker left, send right). Bottom-anchored so it rides up with the keyboard. The model picker (`ModelPicker`) is a bottom sheet on touch and a `position:fixed` upward popover on desktop (`matchMedia("(pointer: fine)")`) — `fixed` is required to escape the composer's `overflow:hidden` ancestors. The `+` ("Add to chat") button opens `InputPlusMenu`, which — like `ModelPicker` — branches presentation by pointer type (`matchMedia("(pointer: fine)")`, one component, no native fork): **touch** gets the Claude-iOS-style **bottom sheet** (grab handle, top-left `X` / `‹` back on the sub-page, centered title, a 3-tile attach row Camera · Photos · Files, a grouped `›`-row card, in-place "Add to project" sub-page); **desktop (mouse)** gets a `position:fixed` upward-opening **anchored popover** — a vertical list of icon+label rows (Camera/Photos/Files), a thin divider between the attachment group and the "Add to project" row, and a trailing `›` chevron on that submenu row (the same `ProjectSubPage` renders inside the popover with a `‹` back row). `fixed` is required to escape the composer's `overflow:hidden` ancestors. The two presentations share all state/handlers/items — only layout differs; there are no toggle or keyboard-shortcut items in this menu, so the checkmark/shortcut-hint affordances aren't rendered. On web/desktop, tiles retarget the composer's single hidden `<input>` via `openFilePicker({capture, imagesOnly})` (sets `accept`/`capture` then `.click()`). In the iOS shell (`isNative()`), the Camera + Photos tiles instead use `@capacitor/camera` native pickers (`lib/native/camera.ts`) — the web `<input>` can't differentiate them and crashes on `capture` in WKWebView; Files keeps the web `<input>` everywhere. The **Files** tile's `accept` is documents-only (`.pdf,.txt,.md,.csv`, **no `image/*`**) so iOS opens the document picker directly instead of the unified Photo/Camera/Files sheet — a web-only fix, no native file-picker plugin (images on iOS go through the native Photos tile). Both acquisition paths converge at `ingestFiles` → the same guards + `processFile`, so the web case is byte-for-byte unchanged. A compact "filed to project" draft chip (new-chat pre-send state) docks **inside** the composer box, top-left above the input row, via `MessageInput`'s `draftProject` prop (no emoji; ✕ unfiles). Sheet open + tile/row taps fire `lightHaptic()` (web vibrate); `@capacitor/haptics` was deliberately not added (would force an Xcode rebuild). A native `UIMenu` plugin was rejected for the same reason — the sheet is pure web so it ships via `git push`.

---

## System Prompt Builders

**Single entry point:** `buildSystemPrompt(ctx: SystemPromptContext)` in `lib/chat/buildSystemPrompt.ts`. Routes pass a `SystemPromptContext` and get back `SystemPromptBlocks` (an `Anthropic TextBlockParam[]`) — they never assemble prompt fragments, append tool blocks, or concatenate identity/household/member layers themselves.

**PROMPT CACHING RULE:** `buildSystemPrompt` returns exactly two blocks. Block 1 holds every layer stable across a chat's messages (identity, household, MARKET_INTELLIGENCE, chat context incl. project instructions/files, tool system blocks) and carries `cache_control: {type: "ephemeral"}` — the cache prefix through this block also covers the tools array. Block 2 holds the volatile per-message layers (member layer with timestamp + memory, location, reminders, browser context). Never put anything that changes per-message into block 1 — it will silently kill the cache. `runChatStream` additionally marks the last message of each API call with a cache breakpoint (`withCacheBreakpoint`) so the conversation prefix is cached incrementally across user turns and across tool-loop iterations.

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

**Generation:** `app/api/memory/generate/route.ts` — called with `keepalive: true` on component unmount AND on `pagehide` (iOS PWA kills pages without unmounting; `useChatMemory` fires on whichever happens first, once per mount). Extraction runs on `HAIKU_MODEL`; the model returns `category: memory` lines (professional|preference|personal|context), parsed by `parseMemoryLine` with keyword `classifyMemory` as fallback. Determines type (private vs shared) from chat type and member count.

**Admin access:** `/admin/memory` shows aggregate counts per member via `get_memory_metrics()` (SECURITY DEFINER function, migration 018). No content access ever.

---

## Chat Architecture

All three chat contexts (standalone, project, family) share the same code paths. Context wrappers (`ChatWindow`, `ProjectChatView`, `FamilyChatWindow`) assemble per-context data and callbacks; visual rendering, streaming, persistence, and memory generation are shared.

| Concern | Shared module |
|---|---|
| Bubble rendering | `components/chat/MessageBubble.tsx` |
| Message list | `components/chat/MessageList.tsx` |
| Input bar (send/stop/attach) | `components/chat/MessageInput.tsx` |
| Input "+" ("Add to chat") menu — touch bottom sheet / desktop anchored popover (attach items + add-to-project sub-page) | `components/chat/InputPlusMenu.tsx` |
| Project picker list (icon + name + member pips) — welcome-screen assign selector | `components/chat/ProjectPickerList.tsx` (exports `ProjectMemberPips`, reused by the `+` sheet) |
| New-chat "assign to project" selector | `components/chat/ProjectAssignSelector.tsx` |
| Top bar shell (back/title/right slot) | `components/chat/ChatTopBar.tsx` |
| Server stream + tools + persistence | `lib/chat/streamHandler.ts` |
| Client stream consumer + finalizer (flush, abort, image-req, final text/task) | `lib/chat/clientStream.ts` |
| Memory generation on unmount | `lib/chat/useChatMemory.ts` |
| Reaction state (initial seed, post-stream reload, optimistic toggle) | `hooks/useChatReactions.ts` |
| Per-chat session (device location, mark-read, delete message, retry) | `hooks/useChatSession.ts` |
| Shared-browser panel state + lifecycle | `hooks/useBrowserPanel.ts` |
| Shared-browser panel UI (Live View iframe + URL bar) | `components/browser/BrowserPanel.tsx` |
| Shared-browser responsive split (desktop grid / mobile overlay) | `components/browser/BrowserSplitLayout.tsx` |
| Sender display name + color resolution | `lib/chat/senderProfile.ts` |

**CHAT UI RULE:** Visual changes (bubble styling, list layout, input bar, top bar layout, dots, indicators) must always be made in the shared components above, never in the context wrappers. Context variations are handled via props — never by forking a component.

**CHAT LOGIC RULE:** Cross-context chat behavior lives in shared hooks, never duplicated in the wrappers. `useChatReactions(chatId, currentUserId, userColorHex, colorMap, initialReactions)` owns the `reactionsMap` and returns `{ reactionsMap, setReactionsMap, loadReactions, handleReact }` — `setReactionsMap` is exposed so the project/family realtime subscriptions can apply INSERT/DELETE events into the same state. `useChatSession({ chatId, currentUserId, messages, setMessages, setInput, setError })` owns device-location lookup, the `/api/chats/mark-read` on-open call, `deleteMessage`, and `handleRetry`. Context-specific concerns stay in the wrapper (e.g. family's `/api/notifications/mark-read` + presence heartbeat, project's instructions-on-unmount, the per-context realtime channels and message subscriptions).

**Move to project:** Standalone private chats the viewer owns can be moved into a project from the input bar. `MessageInput` renders the shared `InputPlusMenu` ("+") whenever attaching or add-to-project is available; the **"Add to project"** grouped row appears **only when** a `moveToProject` config is passed (per-context variation via props — project/family chats omit it). The sub-page renders its own project rows — member-avatar pips kept, leading per-project emoji **not** drawn (render-only; the `projects.icon` data is untouched in the DB — the emoji is no longer rendered at any project-name site: this sub-sheet, `ProjectPickerList`/`ProjectAssignSelector`, `ProjectHome` header, and `ProjectTopBar`), plus a client-side search field and a relative "x ago" (from `created_at` on `GET /api/projects/movable`). Eligibility (`canMoveToProject`, computed in `app/chat/[id]/page.tsx` as `type === 'private' && owner === viewer`) and the move handler live in `ChatWindow`; the move is `PATCH /api/chats/[id]/move` ({ projectId }), gated by RLS (owner + project membership). On success `ChatWindow` sets a local `projectContext` (topbar shows a `[Project] / [Chat]` breadcrumb via `TopBar`'s `projectName` prop, and the menu entry disappears) and calls `refreshChats()` so the sidebar drops the chat from the standalone list. The picker's project list comes from `GET /api/projects/movable` (RLS-gated project visibility; member pips resolved via service role since `users` RLS is own-row-only).

**Assign a new chat to a project at creation:** The welcome screen shows a subtle `ProjectAssignSelector` (a "+ Add to project" pill that opens the same shared `ProjectPickerList`) — only when the user has ≥1 project membership and is not in incognito. `NewChatOrchestrator` holds the selected project; on send it passes `projectId` to `POST /api/chat`, which validates membership (user-client RLS) before creating the chat with `project_id` set. The topbar shows the `[Project] / [Chat]` breadcrumb immediately (same `TopBar` `projectName`), and after the first turn it navigates to the canonical `/projects/[id]/chat/[chatId]` URL.

**Reaction → bubble mapping:** `MessageList` renders reactions on the message whose `id === reactions.message_id`, **regardless of role** (`reactionsMap?.[msg.id]`). Reactions are fully bidirectional — members can react to any message (Bruce's or other members') and Bruce's `react_to_message` tool can react to any member message. The `onReact` prop is now passed to every bubble; the only remaining gate is `!msg.id.startsWith("tmp-")` (no reactions on in-flight messages).

**MESSAGE MAPPING RULE:** All message field mapping from raw Supabase rows or realtime payloads goes through `normalizeMessage()` in `lib/chat/normalizeMessage.ts`. Never build a `Message` / `NormalizedMessage` object from raw DB data inline in a component, subscription handler, or page loader — call `normalizeMessage(row)` and consume the typed result. Shared chat types (`NormalizedMessage`, `ChatMessage`, `MessageAttachment`) live in `lib/chat/types.ts`.

**SYSTEM PROMPT RULE:** All system prompt construction goes through `buildSystemPrompt()` in `lib/chat/buildSystemPrompt.ts`. Routes pass a `SystemPromptContext` (mode, user, memory, location, project metadata, dev extras) — they do not concatenate prompt strings, append tool blocks, or assemble identity/household/member layers themselves. Bruce's core identity, household context, formatting rules, participation rule, and three-tier rule are written once inside `buildSystemPrompt`.

**Streaming model:** the server emits one consolidated assistant message per turn even when tools interleave (no per-turn DB rows). The client consumes the stream through `consumeStream()` with a RAF flush tick so partial markdown renders progressively. An `AbortController` from `ChatWindow`/`ProjectChatView`/`FamilyChatWindow` is passed both to `fetch` and `consumeStream` — pressing Stop in `MessageInput` cancels both, preserves whatever text has been emitted, and marks any in-flight task steps as cancelled.

**STREAM FINALIZER RULE:** When a stream completes, every context computes the final user-visible text and task-progress data through the single `finalizeStream(accumulated)` helper in `lib/chat/clientStream.ts` — never by re-implementing the sentinel/tag stripping inline. `finalizeStream` reuses `parseStreamFrame`'s canonical stripping (task XML tags incl. unclosed, `STATUS` sentinels, `TASK_PROGRESS` sentinels, `image_request` blocks, `\x1f` IMAGE_REQ terminator). All four contexts (`ChatWindow`, `ProjectChatView`, `FamilyChatWindow`, `NewChatOrchestrator`) call it; inline copies had previously drifted (project chat flashed raw `TASK_PROGRESS` sentinels; family chat leaked `STATUS` sentinels).

**Streaming status indicator:** the working-status strip is rendered once, in the shared `MessageList` (driven by its `streamingStatus` prop), so it appears identically in standalone, project, and family chat. It is NOT a top-bar concern — `TopBar` no longer carries a `statusText` prop, and `MessageBubble` does not render status. **Status lifecycle** (in `streamHandler`, via `\x1eSTATUS:text\x1e` sentinels; client takes the *last* one, empty = clear): if no text/tool has streamed 1.5s into a reply, show **"Thinking…"**; a native web-search `server_tool_use` block switches it to **"Searching the web…"**; the first text token clears it. `firstTextSeen` is response-wide so "Thinking…" only ever appears before the first text token (no mid-reply flashes; fast replies never show it).

**Engagement decision (shared, speaker-aware):** `lib/chat/engagement.ts` (`decideEngagement`) is the **canonical multi-member awareness mechanism** — the speaker-aware, context-aware judgment of whether a group message is addressed to Bruce. `/api/family/chat` calls it (the group-project route is intended to call the same module unchanged later — see decisions.md / convergence-spec fork #2). It returns the unchanged outcome set RESPOND / REACT_THUMBS / REACT_HEART / SILENT; react decisions insert a Bruce reaction via `executeReactionTool` and return `X-Bruce-Responded: false` (no model turn); classifier failure falls back to SILENT. Three properties beyond a bare name-match gate: (1) **speaker-aware history** — the `HAIKU_MODEL` classifier sees real per-message sender names (`"Laurianne:"` / `"Bruce:"`), never a flattened `"Member"`; the family route resolves names for the recent window via `nameForSender`. (2) **Open-question window** — `OPEN_QUESTION_WINDOW = 3` (member messages): within that many member messages of one of Bruce's questions/proposals, a nameless reply ("yeah", "sure", "go ahead") is given to the classifier *with Bruce's pending question* so answers-to-his-own-questions trigger; outside the window the path is off. Computed **ephemerally from history** (`findPendingOpenQuestion`) — no stored conversational state, no DB column. (3) **Address vs mention** — a bare `/\bbruce\b/` no longer auto-responds; only a clear vocative/@mention (`isStronglyAddressed`) short-circuits, so a third-person mention between members ("did Bruce add it?") routes to the classifier with speaker context and stays silent. Pure helpers are unit-tested in `lib/chat/__tests__/engagement.test.ts`.

**Chat titles:** new chats get an instant truncated placeholder (`generateChatTitle`), then `generateSmartTitle` (HAIKU_MODEL) runs in parallel with the response stream and updates the `chats` row — the sidebar picks it up on the post-stream refresh.

**Unread indicators:** `chat_members.last_read_at` (migration 024) is updated to `now()` whenever a chat is opened via `POST /api/chats/mark-read`. The sidebar queries `chat_members` on mount and renders an 8px `#0F6E56` dot when `chats.last_message_at > last_read_at` and the latest message wasn't sent by the current user.

**Sidebar context-menu (`Sidebar.tsx`):** one global single-item menu (right-click desktop / 500ms long-press mobile) with **Rename + Delete**, shared across every item type via one `ContextMenuState` + handlers keyed on `kind` (`chat | thread | project`) — there is no shared row component, so the handlers are attached to each divergent row button. Rename (all kinds): chats and family-titled group chats (`thread`) → `chats.title` (supabase user client); projects → `PATCH /api/projects/[id] {name}` (owner-gated, RLS-safe). Delete: projects → `/api/projects` DELETE (FK cascade), others → `/api/chats` DELETE. The native browser menu is suppressed via `e.preventDefault()` on `contextmenu`; the iOS long-press text-callout via the `.sidebar-row` class (rows only, `@media (pointer: coarse)`) — messages/composer/search stay selectable. **Bulk-edit** (multi-select) is a separate path entered by the per-section **"Edit" button**; the menu handlers early-return while that section's select mode is active, so long-press never triggers bulk-select.

## Build Conventions

- **Model:** `lib/models.ts` is the single source of truth — `ModelConfig` entries with effort metadata. Lineup: Opus 4.8, Opus 4.7, Sonnet 4.6 (default), Haiku 4.5 (Opus 4.6 dropped, Fable 5 excluded). Conversation uses the member's `preferred_model`; routes clamp it via `resolveModel()` (stale/removed id → `DEFAULT_MODEL`, never sent raw to the API). Structured side-tasks (titles, memory, family engagement gate) use `HAIKU_MODEL`; pinned system-task routes (family chat, Bruce Dev, instructions summarizer) use `SYSTEM_TASK_MODEL`. Never hardcode a model id — add to `lib/models.ts`.
- **Effort:** per-member `preferred_effort` (null = the model's `defaultEffort`; Sonnet = `medium`). Sent as top-level `output_config: { effort }` only when the model supports it (`validEffortForModel` clamps/omits — Haiku takes none; only Opus 4.8/4.7 take `xhigh`). No `thinking` param is sent (adaptive). Validated on write in `/api/users/me`.
- **Streaming:** all chat responses stream via Anthropic SDK streaming helpers.
- **History windowing:** chat routes replay at most the last 40 messages (descending fetch + reverse). Never load unbounded history into model context.
- **Tool traces:** `runChatStream` persists a compact trace of the turn's tool calls in `messages.metadata.tool_trace` (capped via `lib/chat/toolTrace.ts`); the three chat routes replay it through `formatAssistantReplay()` so follow-up turns keep tool grounding. New chat routes must do the same.
- **History sanitization:** `sanitizeAlternatingMessages` (in `lib/chat/sanitizeMessages.ts`, re-exported from `streamHandler`) MERGES adjacent same-role messages — never drops content.
- **Tests:** `npm test` (vitest). Pure stream-protocol/sanitize/trace logic is covered in `lib/chat/__tests__/` — extend these when touching the streaming protocol.
- **No `any` types.** Use `lib/types.ts`.
- **API keys never leave the server.** API routes and DigitalOcean jobs only.
- **RLS is the privacy wall.** Never bypass on the client. Service role: server-side only.
- **Incognito messages never touch the database.**
- **No console.log in production paths.**
- **Design tokens only.** `app/globals.css` has all tokens. Accent: `#0F6E56`. No Tailwind. Never hardcode a theme-dependent color (text/border/bg) in a component — it WILL break one of the two themes.
- **Hover states:** inline styles can't express `:hover` — use the shared utility classes in `globals.css`: `className="icon-btn"` for square icon buttons, `className="hover-wash"` for rows/buttons (universal inset wash, both themes). Gated on `(hover)+(pointer: fine)` so touch never gets sticky hover.
- **Touch targets:** visually-small controls get `className="hit-target"` (an `::after` that extends the tap area ±8px). Nothing interactive below ~34px effective hit size. **The host element MUST be positioned** (`position: relative`/`absolute`) — the `::after` is `position:absolute; inset:-8px`, so on a `static` host its containing block escapes to the nearest positioned ancestor (worst case the viewport), blanketing the screen and hijacking unrelated taps. (This is what made the docked project chip's ✕ unfile the draft on any input tap.)
- **Z-index:** use the token scale (`--z-drawer-backdrop`, `--z-drawer`, `--z-modal`, `--z-fullscreen`, `--z-toast`, `--z-menu`) — never ad-hoc numbers.
- **Modals:** `role="dialog"` + `aria-modal="true"` + an Escape-close handler, always.
- **Mobile-first.** Every component must work on iPhone.
- **Deploy:** git push to main. Vercel auto-deploys. Never `npx vercel --prod`.
- **Env vars:** API keys live server-side only. Required: `ANTHROPIC_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FAL_KEY`, `JINA_API_KEY`, Google + Firebase keys, and (shared browser) `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`. Add new ones to `.env.local` and Vercel project settings.
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

