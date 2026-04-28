# CLAUDE.md — Bruce Household AI
## Persistent context for Claude Code sessions

Read this file fully before doing anything. It is the source of truth for every
implementation decision. When in doubt, consult it.

---

## What Bruce Is

Bruce is a private household AI for the Johnson family, living at bruce.app.
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
| Domain | bruce.app |

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
│   ├── projects/             # Project workspace (Phase 3)
│   ├── family/               # Family group chat (Phase 4)
│   └── admin/                # Admin panel — Jake only (Phase 5)
├── components/
│   ├── layout/               # Sidebar, MobileNav, TopBar
│   ├── chat/                 # ChatWindow, MessageList, MessageInput, MessageBubble
│   └── ui/                   # Shared primitives
├── lib/
│   ├── supabase/
│   │   ├── client.ts         # Browser client (use client components)
│   │   └── server.ts         # Server client + service role client
│   ├── anthropic/            # API client, memory assembly, streaming
│   ├── types.ts              # TypeScript types matching DB schema exactly
│   └── utils/
├── public/
│   ├── manifest.json         # PWA manifest
│   └── sw.js                 # Service worker (Phase 6)
├── middleware.ts             # Auth protection + session refresh
├── schema.sql                # Complete Supabase schema (source of truth)
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

## Bruce's Group Chat Behavior (Three-Tier Rule)

| Stakes | Action |
|--------|--------|
| Low — add to list, log preference, note something | Act and confirm briefly |
| Medium — update doc, modify project, schedule | Flag before acting |
| High — connector writes, deletions, irreversible | Always ask explicitly |

---

## Build Phases

| Phase | Status | Scope |
|-------|--------|-------|
| 1 — Foundation | ✅ Complete | Supabase, schema, auth, Vercel, DigitalOcean, bruce.app |
| 2 — Core Chat | ✅ Complete | Private chat, streaming, history, memory, welcome screen, incognito |
| 3 — Projects | ⬜ Not started | Project UI, Drive integration, CPS goes live |
| 4 — Household | ⬜ Not started | Remaining members, family chat, notifications |
| 5 — Connectors + Admin | ⬜ Not started | QuickBooks, Petcare, Melio, Calendar, admin panel |
| 6 — Polish | ⬜ Not started | PWA, sharing, image gen, web search |

---

## Phase 2 — Implementation Notes

Phase 2 is complete and deployed to bruce.app. This section records decisions made and issues resolved during the build so future sessions don't relitigate them.

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

## Active Task

*Updated by the planning chat before each Claude Code session.*

**Current:** Phase 2 complete. Ready for Phase 3 — Projects.
