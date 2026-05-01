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
| 5 — Connectors + Admin | ✅ Complete (2026-05-01) | Push notifications, Google Calendar, delete flows, collapsible sidebar, admin panel |
| 6 — Polish | 🔄 In progress | PWA, sharing, image gen, web search |

---

## Phase 2 — Complete

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

## Phase 3 — Complete

---

## Phase 5 — Complete

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

## Phase 4 — Complete

---

## Active Task

*Updated by the planning chat before each Claude Code session.*

**Current:** Phase 6 — Polish

Phase 5 is complete and deployed (2026-05-01). Phase 6 scope: PWA, sharing, image gen, web search.
