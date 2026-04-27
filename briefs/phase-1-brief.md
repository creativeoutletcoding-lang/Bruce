# Phase 1 Task Brief — Foundation
## Hand this to Claude Code to execute

---

## Your job

Initialize the Bruce repository and build all Phase 1 code. The planning
chat has already designed the schema, scaffold, and architecture. Your job
is to implement it cleanly and completely.

Read CLAUDE.md first. Then do everything below in order.

---

## Part A — Repository initialization

Initialize a Next.js 15 project with TypeScript in the current directory:

```bash
npx create-next-app@latest . --typescript --eslint --app --no-tailwind --no-src-dir --import-alias "@/*"
```

When it finishes, remove the boilerplate Next.js files (default page content,
globals.css default styles, any placeholder components).

Install additional dependencies:

```bash
npm install @anthropic-ai/sdk @supabase/ssr @supabase/supabase-js firebase
```

---

## Part B — Files to create

Create each of these files exactly as specified. Do not improvise structure —
CLAUDE.md defines the conventions.

### `CLAUDE.md`
Already exists in the repo root. Do not modify it.

### `schema.sql`
Already exists in the repo root. Do not modify it.

### `next.config.js`
PWA-ready config with image remote patterns for Google profile photos
(lh3.googleusercontent.com) and security headers. Service worker header
for sw.js. No next-pwa wrapper — native Next.js only.

### `.env.example`
Document all required environment variables with comments. Variables needed:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- ANTHROPIC_API_KEY
- NEXT_PUBLIC_FIREBASE_API_KEY
- NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
- NEXT_PUBLIC_FIREBASE_PROJECT_ID
- NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
- NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
- NEXT_PUBLIC_FIREBASE_APP_ID
- NEXT_PUBLIC_FIREBASE_VAPID_KEY
- NEXT_PUBLIC_APP_URL
- ADMIN_EMAIL

### `.gitignore`
Standard Next.js gitignore. Add .env.local explicitly.

### `tsconfig.json`
Strict TypeScript. Path alias @/* → ./*. Next.js plugin included.

### `public/manifest.json`
PWA manifest. Name: "Bruce". Short name: "Bruce". Theme color: #0F6E56.
Background: #ffffff. Display: standalone. Icons at /icons/icon-192.png
and /icons/icon-512.png.

### `public/sw.js`
Minimal service worker for Phase 1 — just enough to satisfy PWA requirements.
Cache the app shell (/, /login). Skip waiting. Claim clients.
Full offline support comes in Phase 6.

### `app/globals.css`
Full Bruce design system. All CSS variables for light and dark mode.
See CLAUDE.md design system section for all token values.
Reset, base typography, scrollbar styling, utility classes.
Dark mode via @media (prefers-color-scheme: dark).
No Tailwind. No external fonts.

### `app/layout.tsx`
Root layout. PWA metadata (manifest, apple-web-app-capable, theme-color).
Viewport: width=device-width, initial-scale=1, maximum-scale=1.
Imports globals.css. suppressHydrationWarning on html tag.
Apple touch icon link. No providers yet — added per-phase as needed.

### `app/page.tsx`
Server component. Gets Supabase session. Redirects authenticated users to
/chat, unauthenticated to /login.

### `app/login/page.tsx`
Client component. Single Google OAuth button. Calls
supabase.auth.signInWithOAuth with provider 'google'. Redirect to
/auth/callback. OAuth scopes: drive.file, documents, spreadsheets,
presentations, calendar. Shows error message if ?error param present.
Design: centered card, "Bruce" wordmark, "Johnson Household" subtitle,
Google button with SVG Google icon, "Invitation required" note below.
No logo, no branding beyond the wordmark. Uses CSS variables only.

### `app/auth/callback/route.ts`
GET handler. Exchanges OAuth code for session via
supabase.auth.exchangeCodeForSession. On first login (no existing users
row): inserts user row with id, email, name (from user_metadata.full_name),
avatar_url (from user_metadata.avatar_url), and role. Role is 'admin' if
email matches ADMIN_EMAIL env var, otherwise 'member'. Redirects to / on
success, /login?error=auth on failure. Handles x-forwarded-host for
production vs local.

### `middleware.ts`
Refreshes Supabase session on every request (required by @supabase/ssr).
Protects all routes — unauthenticated users redirect to /login.
Authenticated users on /login redirect to /.
Admin panel (/admin/*) checks users.role = 'admin', redirects to / if not.
Public routes: /login, /auth/callback, /invite.

### `lib/supabase/client.ts`
createClient() using createBrowserClient from @supabase/ssr.
For use in Client Components only.

### `lib/supabase/server.ts`
createClient() using createServerClient from @supabase/ssr with cookies().
For Server Components and API routes.
createServiceRoleClient() using @supabase/supabase-js directly with
SUPABASE_SERVICE_ROLE_KEY. Marked clearly: server-side only, bypasses RLS.

### `lib/types.ts`
TypeScript types for every database table. Match schema.sql exactly.
Types needed: User, Household, HouseholdContext, HouseholdMember,
HouseholdMemory, Project, ProjectMember, Chat, ChatMember, Message,
File, Memory, Notification, PendingMemory, InviteToken, MemoryBudget.
All union types for constrained string fields (UserRole, ChatType, etc.).

---

## Part C — Verify it runs

```bash
npm run dev
```

Should start without errors on localhost:3000.
Navigating to / should redirect to /login.
The login page should render with the Google button.
No TypeScript errors on build: `npm run build`

---

## Part D — Initial commit

```bash
git add .
git commit -m "Phase 1: foundation — schema, auth, scaffold, design system"
```

---

## What you must NOT do

- Do not create any chat UI — that is Phase 2
- Do not create any project UI — that is Phase 3
- Do not add Tailwind — it is not in the stack
- Do not add any UI component library
- Do not use localStorage anywhere
- Do not expose SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY to client components
- Do not modify schema.sql or CLAUDE.md

---

## Manual steps (Jake does these — not you)

These require dashboard access Claude Code cannot have:

1. Create Supabase project and run schema.sql in SQL editor
2. Set up Google Cloud project, enable APIs, configure OAuth consent screen
3. Wire Google OAuth into Supabase Auth dashboard
4. Create .env.local with real values
5. Connect GitHub repo to Vercel
6. Add environment variables in Vercel dashboard
7. Configure bruce.app domain in Vercel
8. Provision DigitalOcean droplet

The setup guide in PHASE-1-SETUP.md covers all of these step by step.

---

## When you're done

Report back:
- Which files were created
- Any assumptions you made
- Any issues encountered
- Confirmation that `npm run dev` and `npm run build` pass clean
