# CLAUDE.md — Bruce Household AI
## Persistent context for Claude Code sessions

Read this file fully before doing anything. It is the source of truth for every
implementation decision. When in doubt, consult it.

---

## What Bruce Is

Bruce is a private household AI for the Johnson family, living at heybruce.app.
Not a product. Infrastructure. Built to feel like a trusted family presence.
The closest reference is Claude.ai — same structure, extended with a shared
household dimension.

**Core identity Bruce should always express:** calm, reliable, consistent,
intelligent, caring.

---

## Household Members

| Name | Age | Role | Notes |
|------|-----|------|-------|
| Jake | 36 | Admin | Runs the build. Account exec at FIG, co-owner of CPS. |
| Laurianne | 33 | Member | Full private workspace. |
| Jocelynn | 16 | Member | Treated as adult. Full private workspace. |
| Nana | 69 | Member | Jake's mother. Co-owner of CPS. |

Kids in shared memory context only (no accounts): Elliot (8), Henry (5), Violette (5).

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript |
| Hosting | Vercel — auto-deploy from GitHub main |
| Database | Supabase (Postgres + RLS + Realtime) |
| Auth | Supabase Auth + Google OAuth |
| Background jobs | DigitalOcean droplet + PM2 |
| Push notifications | Firebase Cloud Messaging |
| AI model | Anthropic API — claude-sonnet-4-6 |
| Image gen | Replicate |
| Web search | Perplexity API |
| Domain | heybruce.app |

---

## Repository Structure

```
bruce/
├── app/
│   ├── layout.tsx            # Root layout, global styles, PWA meta
│   ├── page.tsx              # Redirects to /chat or /login
│   ├── globals.css           # Design tokens and reset
│   ├── login/
│   │   └── page.tsx          # Google OAuth login
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts      # OAuth exchange + first-login user creation
│   ├── chat/                 # Standalone chats (Phase 2)
│   │   ├── layout.tsx        # Auth guard + ChatShell wrapper
│   │   ├── page.tsx          # Welcome screen + new chat
│   │   └── [id]/
│   │       └── page.tsx      # Existing chat view
│   ├── projects/             # Project workspace (Phase 3)
│   │   ├── layout.tsx        # Auth guard + ChatShell wrapper
│   │   └── [id]/
│   │       ├── page.tsx      # Project home screen (server component)
│   │       └── chat/
│   │           └── [chatId]/
│   │               └── page.tsx  # Project chat view
│   ├── api/
│   │   ├── chat/route.ts             # Standalone chat streaming
│   │   ├── memory/generate/route.ts  # Memory generation on unmount
│   │   ├── users/route.ts            # GET all active household members
│   │   ├── admin/
│   │   │   └── invites/
│   │   │       ├── route.ts          # POST create invite token (admin only)
│   │   │       └── [token]/
│   │   │           └── route.ts      # GET validate token (public)
│   │   └── projects/
│   │       ├── route.ts              # GET list, POST create
│   │       └── [id]/
│   │           ├── route.ts          # GET detail, PATCH, DELETE
│   │           ├── members/route.ts  # POST add, DELETE remove
│   │           ├── chat/route.ts     # POST streaming project chat
│   │           ├── instructions/
│   │           │   └── update/route.ts  # POST living instructions update
│   │           └── files/
│   │               ├── route.ts      # GET list, POST attach, DELETE detach
│   │               ├── browse/route.ts  # GET Drive files for project folder
│   │               └── upload/route.ts  # POST create new file in Drive
│   ├── join/
│   │   └── page.tsx              # Public invite landing page
│   ├── family/               # Family group chat (Phase 4)
│   └── admin/
│       └── invites/
│           └── page.tsx          # Admin invite generator (stub — Phase 5 gets full panel)
├── components/
│   ├── layout/               # ChatShell, Sidebar (with projects + chats sections)
│   ├── chat/                 # ChatWindow, MessageList, MessageInput, MessageBubble, TopBar
│   ├── project/              # ProjectHome, ProjectChatWindow, ProjectTopBar
│   └── ui/                   # Shared primitives
├── lib/
│   ├── supabase/
│   │   ├── client.ts         # Browser client (use client components)
│   │   └── server.ts         # Server client + service role client
│   ├── anthropic/            # buildSystemPrompt, buildProjectSystemPrompt, assembleMemoryBlock
│   ├── google/
│   │   └── drive.ts          # Drive client: ensureBruceFolders, listProjectFiles, getFileContent, uploadFile
│   ├── types.ts              # TypeScript types matching DB schema + API response shapes
│   └── utils/
├── public/
│   ├── manifest.json         # PWA manifest
│   └── sw.js                 # Service worker (Phase 6)
├── middleware.ts             # Auth protection + session refresh
├── schema.sql                # Complete Supabase schema (source of truth)
├── migrations/
│   ├── 003_google_tokens.sql # Adds 6 Google token/folder columns to users table
│   └── 004_invite_rls.sql    # Adds public anon SELECT policy for invite token validation
├── scripts/
│   ├── seed-cps.ts           # One-time: creates CPS — Operations project, adds Jake as owner
│   └── seed-cps-nana.ts      # One-time: adds Nana to CPS after she accepts invite
├── docs/
│   └── google-oauth-setup.md # Step-by-step Google Cloud Console + Supabase config
├── tsconfig.scripts.json     # ts-node compatible tsconfig for seed scripts
├── CLAUDE.md                 # This file
└── .env.example              # All required env vars documented
```

---

## Design System

**Accent color:** `#0F6E56` — deep blue-green. Used for active states, send button, selected items, highlights.

**Mode:** Light/dark follows device system setting automatically. CSS variables handle the switch.

**All design tokens are in `app/globals.css`.** Never hardcode colors or spacing. Always use CSS variables.

Key tokens:
```css
--accent: #0F6E56
--bg-primary / --bg-secondary / --bg-sidebar
--text-primary / --text-secondary / --text-tertiary
--border / --border-strong
--radius-sm / --radius-md / --radius-lg / --radius-full
--sidebar-width: 260px
--topbar-height: 52px
--mobile-nav-height: 56px
--transition: 150ms ease
```

**Typography:** System font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`). No external fonts unless explicitly specified.

**Mobile-first.** Every component must work on iPhone. Desktop is fully supported, same experience.

---

## Database — Key Rules

1. **Never bypass RLS on the client.** All queries use the anon client. RLS is the privacy wall.
2. **Service role client is server-side only.** API routes and DigitalOcean jobs only. Never in components.
3. **Incognito messages never touch the database.** Session-only, gone when the chat closes.
4. **Memory is owner-only.** The admin policy does NOT apply to the memory table. No exceptions.
5. **Schema lives in `schema.sql`.** If you need to alter the schema, update that file and provide the migration SQL separately.

All types are in `lib/types.ts`. Use them. Don't redefine inline.

---

## Supabase Client Usage

```typescript
// In a Client Component:
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();

// In a Server Component or API Route:
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();

// In a background job (DigitalOcean) — bypasses RLS:
import { createServiceRoleClient } from "@/lib/supabase/server";
const supabase = createServiceRoleClient();
```

---

## Anthropic API — Key Rules

1. **Model:** always `claude-sonnet-4-6`. Never hardcode another.
2. **Streaming:** all chat responses stream. Use the Anthropic SDK streaming helpers.
3. **Memory budget:** max 500 words sent per API call. Assembly order:
   - Household shared context
   - User's core memories (all, max 20)
   - User's active memories (top 15 by relevance score)
4. **System prompt construction** happens server-side in an API route. Client never touches the API key.
5. **Project context:** when in a project chat, include project instructions + relevant file summaries in the system prompt.

---

## Navigation Structure

**Desktop:** Persistent left sidebar (260px). Sections: Projects (top), Chats (standalone only, flat list), Family (pinned bottom). Never mixes project chats into the standalone list.

**Mobile:** Bottom nav (Home, Chats, Projects, Family). Sidebar becomes slide-out drawer via hamburger top-left. Inside a chat: bottom nav disappears, top bar + back arrow.

---

## Bruce's Group Chat Behavior

**Trigger:** `/@bruce\b/i` (case-insensitive, word boundary) or natural-language address ("Bruce, can you…"). No engagement window — if nobody addresses Bruce, no Anthropic call is made.

**Three-Tier Rule**

| Stakes | Action |
|--------|--------|
| Low — add to list, log preference, note something | Act silently or with a single word at most. No "Done.", "Got it.", "Added." — reactions (Phase 6) will handle acknowledgment. |
| Medium — update doc, modify project, schedule | Flag before acting: "I can do X — want me to go ahead?" |
| High — connector writes, deletions, irreversible | Always ask explicitly before acting. No exceptions. |

**Tone rules:** No filler ("got it", "sure thing", "fingers crossed"). No self-doubt. No deflecting to specific household members. If the action speaks for itself, stop — no appended meta-commentary. Emotional messages: one or two sentences, warm and grounded, never therapist-mode.

---

## Build Phases

| Phase | Status | Scope |
|-------|--------|-------|
| 1 — Foundation | ✅ Complete | Supabase, schema, auth, Vercel, DigitalOcean, heybruce.app |
| 2 — Core Chat | ✅ Complete | Private chat, streaming, history, memory, welcome screen, incognito |
| 3 — Projects | ✅ Complete | Project UI, Drive integration, invite flow, CPS goes live |
| 4 — Household | ✅ Complete | Family group chat, group threads, member avatars, Bruce behavior |
| 5 — Connectors + Admin | 🔄 In progress | Push notifications, QuickBooks, Petcare, Melio, Calendar, admin panel |
| 6 — Polish | ⬜ Not started | PWA, sharing, image gen, web search |

---

## Phase 2 — Implementation Notes

Phase 2 is complete and deployed to heybruce.app. This section records decisions made and issues resolved during the build so future sessions don't relitigate them.

### What was built

- **Welcome screen** — time-of-day greeting, 2×2 suggestion cards, input below. Suggestion cards populate the input; view stays on welcome screen until the user sends.
- **Streaming chat** — `POST /api/chat` streams tokens via `ReadableStream`. Client reads with `getReader()`, appends tokens to the message as they arrive. No spinner before first token.
- **Chat persistence** — chat row created on first message, not before. User message and Bruce's message inserted server-side via service role. `last_message_at` updated after Bruce's message lands.
- **Sidebar** — desktop persistent, mobile slide-out drawer. Real-time subscription on `chats` + `messages` tables. Highlights active chat with accent left border.
- **Memory** — 8 core memories seeded in `auth/callback` on first login. `lib/anthropic/index.ts` assembles core (max 20) + active (max 15, ordered by relevance) into a 500-word-ceiling block prepended to every system prompt. Memory generation fires on chat unmount via `keepalive` fetch to `/api/memory/generate`.
- **Incognito mode** — `filter: saturate(0.15)` on the chat container. Messages in local state only. Memory generation skipped.
- **Settings** — placeholder page at `/settings`.

### Key decisions

**Supabase anon key format** — The new `sb_publishable_` format does not work with `@supabase/ssr`. The key in `.env.local` must be the legacy JWT format. If you rotate credentials, request the legacy format from the Supabase dashboard or the JWT will be rejected during session exchange.

**Sidebar refresh — dual approach** — Supabase Realtime `postgres_changes` INSERT events race against RLS row visibility: the event can fire before the new row is readable by the subscriber's JWT. Using realtime alone for new chat creation was unreliable. Fix: `ChatShell` holds a `Set` of `loadChats` callbacks (one per Sidebar instance — desktop and mobile) via `refreshChats` / `registerRefresh` in `ChatContext`. `NewChatOrchestrator` calls `refreshChats()` immediately after `X-Chat-Id` is confirmed in the response headers (guaranteeing the row is committed), then calls `router.push`. Realtime subscription is kept for updates to existing chats, which it handles reliably.

**`router.push` not `router.replace`** — When navigating from `/chat` to `/chat/[id]` after new chat creation, `router.replace` can silently no-op in Next.js App Router when the layout is already mounted. `router.push` creates a proper forward navigation entry and reliably triggers the children-slot swap.

**ChatShell renders two Sidebar instances** — desktop sidebar and mobile drawer are both always mounted. Both register their `loadChats` via `registerRefresh`. Using a `Set` (not a single ref) ensures `refreshChats()` calls both. The Set is never cleared since both Sidebars stay mounted for the layout lifetime.

**`refreshChats` fires before `router.push`** — ensures the sidebar reloads while still on `/chat` where both Sidebar instances are guaranteed mounted and registered, before navigation transitions the children slot.

### Bugs fixed during Phase 2

- **Input flash on welcome screen** — typing in the message input triggered `setStarted(true)`, switching the component's return branch mid-keystroke, unmounting the focused input, and dropping all but the first character typed. Fixed by removing the `started` state entirely. The branch condition is now `messages.length === 0` only — the welcome screen stays mounted until the user actually sends.
- **Sidebar not updating on new chat** — Supabase Realtime INSERT events for new chat rows weren't reliably delivered due to RLS timing. Fixed with the direct `refreshChats` callback described above.
- **React strict mode channel error** — `useEffect` double-invocation in development caused "cannot add callbacks after subscribe" errors on the Supabase realtime channel. Fixed by moving the client to component scope and checking `supabase.getChannels()` for an existing channel with the same topic before subscribing.
- **Memory generation firing on every message** — `triggerMemoryGeneration` was in `useCallback` with `messages.length` as a dep. Each new message caused a new callback reference, triggering the effect cleanup (which called the old callback) on every render. Fixed by using `useRef` for messages/incognito and an empty-dep `useEffect` so cleanup only fires on true unmount.

---

## Conventions

- **No `any` types.** Use proper types from `lib/types.ts`.
- **API routes are in `app/api/`.** Client components call these. API keys never leave the server.
- **Components use CSS-in-JS via inline `style` objects** with CSS variables, or plain CSS modules. No Tailwind — it's not installed.
- **Every UI component must handle loading, error, and empty states.**
- **Error boundaries** around chat and project views.
- **No console.log in production paths.** Use proper error handling.

---

## What To Do When Starting a Session

1. Read this file.
2. Check which phase is active (table above).
3. Read the task brief provided — it will be specific.
4. Implement exactly what's described. If something is ambiguous, implement the most reasonable interpretation and note what you assumed.
5. Update the phase status in this file when a phase is complete.

---

---

## Phase 3 — Implementation Notes

Phase 3 Task 1 (Project infrastructure and home screen) is complete. This section records decisions.

### What was built

- **API routes** — `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/[id]`, `POST/DELETE /api/projects/[id]/members`, `POST /api/projects/[id]/chat` (streaming), `POST /api/projects/[id]/instructions/update`, `GET /api/users`
- **Sidebar** — Projects section added above Chats. Each project shows icon + name + member pip indicators (accent color with opacity variants). "New project" button opens a modal with icon picker (6 emoji options) and name input. Active project highlighted with accent left border.
- **Project home screen** — Single scrollable column at `/projects/[id]`. Panels: Header (icon + name + stacked member avatars), Instructions (editable textarea, auto-saves on blur, owner/admin only), Files (list with MIME icons + placeholder "Attach file"), Members (list with role badges + "Add member" modal for owners), Connectors (5 static "Not connected" placeholders), Chats (list + "New chat" button that creates a chat row directly via browser Supabase client).
- **Project chat** — `/projects/[id]/chat/[chatId]`. Uses `ProjectChatWindow` (reuses `MessageList`, `MessageInput`) + `ProjectTopBar` (back → project home, project name). Calls `/api/projects/[id]/chat` streaming endpoint. Fires living instructions update on unmount.
- **Living instructions** — On `ProjectChatWindow` unmount, sends keepalive POST to `/api/projects/[id]/instructions/update`. Route loads last 10 messages, asks Claude if instructions should change, writes only if text differs.
- **Project system prompt** — `buildProjectSystemPrompt()` added to `lib/anthropic/index.ts`. Base identity + memory block (same 500-word ceiling) + project block (name, instructions, members, files) appended separately.
- **Chat title generation** — Project chats use `generateChatTitle(message)` (synchronous substring, same as standalone chats) called before streaming begins. Title is saved to DB before the stream starts and sent as `X-Chat-Title` response header. *(Note: an earlier implementation used an async Anthropic call in the `finally` block — that was replaced because the title wasn't reliably saved before the user navigated back to project home.)*

### Key decisions

**Service role for user profile reads** — The `users` RLS policy (`id = auth.uid() OR is_admin()`) means non-admins can only see their own row. Two places require all household members: (1) `GET /api/users` for the member picker, (2) building the member list in `GET /api/projects/[id]` and the project chat system prompt. Both use the service role client purely for reading names/avatars — permission checks still use the authenticated client. Noted in each route with a comment.

**`app/projects/layout.tsx` reuses `ChatShell`** — Same pattern as `app/chat/layout.tsx`. The projects layout wraps with `ChatShell`, which provides the sidebar + drawer + context. The Sidebar now renders a Projects section above Chats, with `activeProjectId` detection from the pathname.

**Sidebar "sectionHeaderRow" layout** — The Projects section header uses a flex row with the section label and a "+" icon button, unlike the Chats section which uses a plain label. This matches the brief ("New project button at the top of the section").

**"New chat" in project home creates chat row immediately** — Rather than navigating to a blank form, clicking "New chat" inserts a `chats` row with `project_id` set via the browser Supabase client (RLS allows: `owner_id = auth.uid()` and `is_project_member(project_id)`), then navigates to `/projects/[id]/chat/[chatId]`. The project chat page starts with an empty message list.

**Connectors panel is static UI only** — All five connectors (Google Drive, Google Calendar, QuickBooks, Precise Petcare, Melio) render as "Not connected" grey badges. No state, no handlers. Phase 5 work.

---

## Phase 3 Task 2 — Google Drive Integration

Phase 3 Task 2 (Google Drive integration and file attachment) is complete. This section records decisions.

### What was built

- **`lib/google/drive.ts`** — Full Drive client. `getValidToken` fetches stored Google token from DB, refreshes if within 5 min of expiry, saves updated token on refresh. `ensureBruceFolders` creates/finds the three Drive folder hierarchy (Bruce → Personal/Projects). `ensureProjectFolder` finds/creates a subfolder under Projects for a named project. `listProjectFiles`, `getFileContent` (exports Docs/Sheets as text, truncates at 2000 chars), `uploadFile` (multipart upload).
- **`migrations/003_google_tokens.sql`** — Adds `google_access_token`, `google_refresh_token`, `google_token_expires_at`, `google_drive_root_id`, `google_drive_personal_id`, `google_drive_projects_id` columns to `users`.
- **OAuth scope expansion** — `app/login/page.tsx` adds `queryParams: { access_type: "offline", prompt: "consent" }` to force Google to issue a refresh token on every login.
- **`app/auth/callback/route.ts`** — Rewritten to extract `provider_token` + `provider_refresh_token` from session and store them in the `users` row via service role. Calls `ensureBruceFolders` fire-and-forget (non-blocking).
- **File API routes** — `GET/POST/DELETE /api/projects/[id]/files`, `GET /api/projects/[id]/files/browse` (lists Drive folder), `POST /api/projects/[id]/files/upload` (creates new Drive file + DB record).
- **File picker UI** — `ProjectHome` file section has "Attach file" button opening a modal with two tabs: "Browse Drive" (lists existing project folder contents, "Attach" button per file) and "Upload new" (name + content textarea + type selector: note/doc/sheet → "Create and attach"). Attached files show name linked to `drive_url` + "×" remove button.
- **File content injection in project chat** — `/api/projects/[id]/chat` fetches content for each attached file via `getFileContent`, builds a block capped at 3000 chars total. Passed as `fileContentBlock` to `buildProjectSystemPrompt`, which appends it after the file name list.

### Key decisions

**Google OAuth requires `access_type: "offline"` + `prompt: "consent"`** — Without both, Google only returns a refresh token on the very first authorization. After that, the session only has an access token. With `prompt: "consent"`, Google re-issues a refresh token every login. This guarantees the user always has a functional long-lived token stored in the DB.

**Token refresh threshold is 5 minutes** — `getValidToken` checks `google_token_expires_at - 5 minutes`. If the token will expire within 5 minutes, it proactively refreshes. This prevents race conditions where a token expires mid-request.

**`listProjectFiles` uses `ensureProjectFolder`** — Rather than storing a Drive folder ID per project in the DB (extra column, migration), the project folder is derived by looking up the project name and calling `ensureProjectFolder`. This is slightly more expensive (2 Drive API calls) but keeps the schema simpler. If performance becomes an issue, add `google_drive_folder_id` to the `projects` table.

**File content capped at 3000 chars across all files** — A per-file cap risks allocating the entire budget to one file. The 3000-char total cap ensures all files get a fair share of context, with a note appended when files are skipped. This is a conservative limit; adjust in the route if Anthropic context usage allows more.

**Drive upload uses multipart/related** — The Drive v3 API multipart upload sends metadata + content in a single HTTP request. For text content, this is simpler than resumable uploads. The content is base64-encoded in the boundary body. Docs/Sheets are uploaded as plain text and converted by Drive automatically when targeting the `vnd.google-apps.*` MIME type.

---

## Phase 3 Task 3 — CPS Seed, Invite Flow, Phase Wrap

Phase 3 Task 3 is complete. Phase 3 is fully complete.

### What was built

- **`scripts/seed-cps.ts`** — Creates the CPS — Operations project with icon 🐾 and WC instructions. Idempotent. Run with `npm run seed:cps` after Jake's first login.
- **`scripts/seed-cps-nana.ts`** — Adds Nana to CPS as a member. Run with `npm run seed:cps:nana -- nana@email.com` after Nana accepts her invite.
- **`tsconfig.scripts.json`** — ts-node compatible tsconfig (CJS module, Node resolution). Separate from main tsconfig which uses Next.js-specific settings incompatible with ts-node.
- **Invite flow** — End-to-end. `POST /api/admin/invites` creates a 48-hour token (admin only). `GET /api/admin/invites/[token]` validates publicly (no auth needed for new users). `/join` page validates the token and triggers Google sign-in with the token embedded in the redirectTo URL. `auth/callback` extracts the token, validates it, marks it used, then creates the user row.
- **Auth guard for new users** — Uninvited users who complete Google OAuth are redirected to `/join?error=unauthorized`. Admin email (Jake) bypasses invite check. All other first-time users require a valid token.
- **`migrations/004_invite_rls.sql`** — Public anon SELECT policy so the `/join` page can validate tokens without a session.
- **`app/admin/invites/page.tsx`** — Simple admin tool. Server component checks admin role and redirects non-admins. Renders `InviteAdminClient` with email input + generate button + copyable URL output.
- **`middleware.ts` updated** — `/join` and `/api/admin/invites/` added to public (no-redirect) routes. Authenticated users visiting `/join` are redirected to `/chat`.
- **`docs/google-oauth-setup.md`** — Step-by-step setup for Google Cloud Console (APIs to enable, scopes, credentials, redirect URIs) and Supabase dashboard (Google provider config).

### Key decisions

**`tsconfig.scripts.json` instead of `tsconfig.json`** — The main `tsconfig.json` uses `"moduleResolution": "bundler"` and `"module": "esnext"`, which ts-node cannot handle. A separate scripts tsconfig with `"module": "commonjs"` and `"moduleResolution": "node"` is required. Scripts don't use `@/` path aliases — they import from npm packages directly.

**Invite token passed via `redirectTo` URL param, not OAuth state** — Supabase manages the OAuth `state` parameter internally for CSRF protection. The correct approach is to embed the invite token in the `redirectTo` URL as a query param (`/auth/callback?invite_token=abc`). Supabase preserves custom query params in the redirect, so the callback receives both `code` and `invite_token`.

**Token is marked used before user row is created** — Prevents a race condition where two near-simultaneous requests with the same token both pass validation before either marks it used. Marking first means the second request gets a valid row check but the token is already used.

**Admin email bypasses invite check** — Jake's first login (bootstrapping the system) happens before any invite tokens exist. ADMIN_EMAIL check skips the invite validation for the admin user only.

**Core memories seeded only for admin** — Previous code seeded Jake's core memories for all new users. Updated to only seed for the admin (Jake). Other household members start with a blank memory slate that fills naturally through use.

---

## Phase 3 Task 4 — Routing Fix and Inline Chat Input

Post-launch fixes and additions after the core Phase 3 deploy.

### What was built

- **Project chat routing fix** — Project chats were opening in the standalone `/chat/[id]` layout instead of the project layout. Fixed in two places: (1) `app/chat/[id]/page.tsx` now queries `project_id` and issues a server-side redirect to `/projects/[id]/chat/[chatId]` if set — this catches any direct URL access or stale link. (2) `Sidebar.tsx` `handleSelectChat` now routes to the project URL if `chat.project_id` is set; `loadChats` double-filters to exclude project chats from the standalone list (belt-and-suspenders against RLS timing).
- **Inline chat input on project home** — Replaced the "New chat" button in the Chats panel header with a full-width textarea bar pinned to the bottom of the project home screen. Placeholder: "Start a conversation about [project name]…". On send: creates a chat row via the browser Supabase client, navigates to `/projects/[id]/chat/[chatId]?q=<message>`, and `ProjectChatWindow` auto-sends the message on mount via a `useEffect` with `initialSentRef` guard. URL is cleaned with `router.replace` immediately so refresh doesn't re-send.

### Key decisions

**Server-side redirect is the authoritative routing fix** — The `app/chat/[id]/page.tsx` redirect handles the case where a project chat ID lands at the wrong URL regardless of how it got there (direct link, stale bookmark, Sidebar bug). The Sidebar fix is belt-and-suspenders but not load-bearing.

**`initialSentRef` prevents double-send in React Strict Mode** — `useEffect` runs twice in development under Strict Mode. The ref ensures `sendMessage(initialInput)` fires exactly once regardless.

**`?q=` param over state or sessionStorage** — Passing the initial message as a URL search param keeps the handoff simple (no shared state, no storage), works across full page loads, and is cleaned from the URL before the user can copy or refresh it.

---

## Phase 6 — Polish Notes

### Planned Additions

**Delete functionality (user-facing)**

- Delete individual standalone chats
- Delete individual project chats
- Archive/delete a project (owner only)
- Clear all chats within a project

All deletes are soft-delete where possible (status field), hard delete for chats and messages. Confirmation prompt required before any delete action.

---

---

## Phase 4 — Implementation Notes

### Task 2 — Family Group Chat (complete)

#### What was built

- **`migrations/005_family_group.sql`** — Expands `chats.type` CHECK constraint to include `'family_group'`. Adds a type-based RLS policy so all authenticated members can read the family chat row.
- **`app/api/family/chat/route.ts`** — POST streaming endpoint. Saves the user message, loads recent history, determines if Bruce should respond (server-side `shouldBruceRespond()`), streams Bruce's reply if yes. Returns `X-Bruce-Responded: false` and exits immediately when Bruce is passive and not directly addressed.
- **`app/family/layout.tsx`** — Auth guard + ChatShell wrapper, same pattern as chat/projects layouts.
- **`app/family/page.tsx`** — Server component. Loads the existing family_group chat if one exists, renders FamilyChatWindow with it. Shows an empty state if no chat exists. No auto-creation.
- **`components/family/FamilyTopBar.tsx`** — Top bar: mobile hamburger, centered "🏠 Family" title, invisible spacer for centering. No Bruce toggle.
- **`components/family/FamilyChatWindow.tsx`** — Accepts `topbar: React.ReactNode` prop and optional `placeholder` prop. Features: member-attributed messages (sender name above each run, color-coded by member), typing dots → "Bruce is working on it…" working indicator, long press + right-click context menu with "Ask Bruce" and "Copy" actions, realtime subscription for other members' messages, auto-dedup of optimistic/streaming messages via DB reload after each send.
- **Sidebar** — Family section: Family Chat button at top, thread list below, "New Thread" (+) button in the section header. Chats list excludes `family_group` and `family_thread` types. Realtime subscription triggers `loadFamilyThreads()` on chats table changes.
- **ChatShell** — Added mobile bottom nav (Home, Projects, Family tabs). Nav hides when inside a specific standalone chat, project chat, or family thread (`/family/threads/[id]`). Fixed nav via `position: fixed`; main content avoids overlap via `with-bottom-nav` CSS class.
- **`auth/callback`** — ~~On every new user login, checks if a family_group chat exists and adds the user to `chat_members` if not already a member.~~ This auto-join-on-login logic has been removed. Users are no longer automatically added to any family_group chat on sign-in.

#### Key decisions

**Bruce trigger logic (server-side, hard gate)** — No client-side pause state, no engagement window. `shouldBruceRespond()` checks only the current message: `/@bruce\b/i` or natural-language address ("Bruce, ..."). If not directly addressed, no Anthropic call is made at all — Bruce is fully silent. The earlier 4-message engagement window was removed because it caused Bruce to respond to conversational messages not directed at him.

**Family chat — no auto-creation** — `ensureFamilyChat()` has been removed. `/family` just queries for an existing `family_group` chat and displays it; if none exists it shows an empty state. The chat must be created explicitly (e.g., via sidebar "New Group Chat" or direct DB insert). The self-healing behavior was removed because it made deletion appear broken.

**Realtime dedup strategy** — Sender's own messages are shown optimistically then DB-reloaded after API call completes (replacing temp IDs). Other members' messages arrive via realtime subscription and are appended immediately. Bruce streaming messages are handled in the streaming path, then replaced by DB reload. This avoids complex state sync.

**Member color palette** — Jake: `#0F6E56` (accent), Laurianne: `#7C5CFC` (purple), Jocelynn: `#E8607A` (rose), Nana: `#D97706` (amber). Keyed by first name. Applied to sender name label and member bubble border.

**Mobile bottom nav** — `position: fixed` at viewport bottom. Hidden on desktop via CSS `@media (max-width: 768px)`. Main content avoids overlap via `with-bottom-nav` CSS class (not inline style, so `!important` in the class overrides any inline padding). The nav disappears entirely when inside standalone chats, project chats, or family threads.

### Task 2 Addendum — Member Avatars and Tone Refinement (complete)

Additional work completed after the core family chat and threads build.

- **Sidebar thread avatar stack** — Each thread row in the sidebar shows a compact avatar stack (18px circles, 1.5px border, -5px overlap, max 3 + "+N" overflow). `GET /api/family/threads` enhanced to batch-fetch member data for all threads in two queries (no N+1). Returns `members: [{id, name, avatar_url}][]` per thread.
- **Topbar member avatar stack with sheet** — `FamilyThreadTopBar` shows a tappable avatar stack (22px circles, -7px overlap, max 3 + "+N") between the title and the three-dot menu. Tapping opens a member sheet overlay listing all thread members with their avatars and full names.
- **Bruce tone and silence rules** — System prompt updated in `buildFamilyChatSystemPrompt()`: hard silence rule (no acknowledgment at all when not addressed), three-tier judgment with explicit low-stakes silence behavior, named filler ban list, no self-doubt, no name-deflecting, stop after action speaks for itself, emotional messages capped at 1-2 sentences.
- **Removed: engagement window** — The 4-message engagement window was removed from `shouldBruceRespond()` in `app/api/family/chat/route.ts`. Bruce now only responds when the current message directly addresses him.
- **Removed from scope: cross-context routing** — Planned feature for Bruce to route a request from family chat into a project was deferred indefinitely; too much complexity for unclear value.
- **Deferred to Phase 6: message reactions** — iMessage-style reactions (👍 etc.) that would handle low-stakes acknowledgment were originally planned for Phase 4. Moved to Phase 6 Polish.

#### Notable decisions

**Notification model (decided, not yet built)** — @ mention in family chat or thread sends a push to mentioned member(s) once. Suppressed while the recipient has the app active in that thread. Resets after 30 minutes of inactivity. Implementation is Phase 5 work.

**Commit discipline** — Never push without an explicit `git push` command. There was a 54-file gap discovered when assuming pushes happened automatically. Every session: verify what's on main before assuming deploy state.

---

### Task 2 Addendum — Family Threads (complete)

Family threads are named sub-topic conversations inside the Family section.

- **`migrations/006_family_threads.sql`** — Adds `'family_thread'` to `chats.type` CHECK. Adds `deleted_at TIMESTAMPTZ` column for soft delete. Type-based RLS policies for thread SELECT/messages SELECT/messages INSERT — no `chat_members` needed.
- **`app/api/family/threads/route.ts`** — `GET` lists threads (type='family_thread', deleted_at IS NULL, ordered by recency). `POST` creates a new thread row.
- **`app/api/family/threads/[id]/route.ts`** — `DELETE` soft-deletes by setting `deleted_at`, restricted to `type='family_thread'` for safety.
- **`app/family/threads/[id]/page.tsx`** — Server component. Loads thread (redirect to /family if deleted or not found), loads members and messages, renders FamilyChatWindow with `topbar={<FamilyThreadTopBar />}`.
- **`components/family/FamilyThreadTopBar.tsx`** — Back button → `/family`, thread name (truncated), three-dot menu with "Delete thread" item, confirmation modal.
- **Thread RLS via chat_members** — Family threads use `chat_members` join for RLS (not type-based open access). Only members can see a thread's chats row and messages. Migration 007 replaces the type-based migration 006 policies with membership-gated policies.
- **Thread creation with member picker** — New Thread modal in Sidebar fetches household members on open (lazy). All members selected by default; any can be deselected. `memberIds` array sent in POST; creator always added server-side. If no list provided, defaults to all active members.
- **Add Member in thread topbar** — Three-dot menu in FamilyThreadTopBar has "Add member" item. Opens a modal listing household members not yet in the thread. One selection at a time, POST `/api/family/threads/[id]/members`. New member can immediately see the thread via updated RLS.
- **Sidebar thread list** — Below the Family Chat button. Active thread highlighted with accent border. "+" button opens New Thread modal (name + member picker).

---

### Task 2 Addendum — Permanent Family Chat Removed (complete)

The `family_group` chat is no longer treated as permanent or undeletable.

- **`app/api/chats/route.ts`** — `DELETE` handler now includes `"family_group"` in the allowed types list. Right-click/long press on the Family Chat button in the sidebar shows a Delete option.
- **`components/layout/Sidebar.tsx`** — Family Chat button now supports `onContextMenu`/`onTouchStart`/`onTouchEnd`/`onTouchMove` handlers (same pattern as threads). `handleSingleDelete` handles `kind === "family_group"` by calling the chats delete API and navigating to `/chat` if the family route is active.
- **`ensureFamilyChat()` removed** — The auto-creation function and its call in `app/family/page.tsx` are deleted. `/family` now shows whatever `family_group` chat exists in the DB, or an empty state if none does. No self-healing.

---

## Active Task

*Updated by the planning chat before each Claude Code session.*

**Current:** Phase 5 — Connectors + Admin

Phase 4 is complete and deployed. Build order for Phase 5:

1. **Push notifications** — Firebase Cloud Messaging. @ mention in family chat/thread sends push to mentioned member. Suppress while recipient is active in that thread. Reset after 30 min inactivity.
2. **QuickBooks connector** — Read-only. Pull P&L, invoice status, outstanding AR for CPS. Surface in a project context block.
3. **Precise Petcare connector** — Read appointment/client data for CPS. Surface in project context.
4. **Melio connector** — Bill pay status for CPS. Surface in project context.
5. **Google Calendar connector** — Read family calendar events. Surface in chat context when relevant.
6. **Admin panel** — Full invite management, user management, memory audit UI. Replaces the stub at `/admin/invites`.
