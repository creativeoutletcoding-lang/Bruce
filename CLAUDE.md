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
| 2 — Core Chat | 🔄 In progress | Private chat, streaming, history, memory, welcome screen, incognito |
| 3 — Projects | ⬜ Not started | Project UI, Drive integration, CPS goes live |
| 4 — Household | ⬜ Not started | Remaining members, family chat, notifications |
| 5 — Connectors + Admin | ⬜ Not started | QuickBooks, Petcare, Melio, Calendar, admin panel |
| 6 — Polish | ⬜ Not started | PWA, sharing, image gen, web search |

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

**Current:** Phase 2 — Core Chat. Awaiting task brief from planning chat.
