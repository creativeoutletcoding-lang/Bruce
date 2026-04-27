# Bruce — Phase 1 Setup Guide
## Foundation: Supabase · Auth · Schema · Vercel · DigitalOcean · bruce.app

Complete these steps in order. Each section has a clear stopping point.

---

## Step 1 — GitHub Repository

1. Create a new private GitHub repo: `bruce`
2. Clone it locally: `git clone git@github.com:your-username/bruce.git`
3. Copy all the scaffolded files from this session into the repo root
4. Initial commit and push to `main`

```bash
git add .
git commit -m "Phase 1: project scaffold"
git push origin main
```

---

## Step 2 — Supabase Project

1. Go to [supabase.com](https://supabase.com) → New project
2. Name: `bruce`
3. Region: pick the one closest to you (US East or US West)
4. Generate a strong database password — save it somewhere safe
5. Wait for project to provision (~2 minutes)

**Run the schema:**

1. In your Supabase project → SQL Editor → New query
2. Paste the entire contents of `schema.sql`
3. Run it — should complete with no errors
4. Verify: go to Table Editor — you should see all tables listed

**Get your API keys:**

Go to Project Settings → API:
- Copy `Project URL` → this is `NEXT_PUBLIC_SUPABASE_URL`
- Copy `anon public` key → this is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Copy `service_role` key → this is `SUPABASE_SERVICE_ROLE_KEY` (server only, never expose)

---

## Step 3 — Google OAuth via Supabase

**In Google Cloud Console:**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project: `Bruce`
3. Enable APIs:
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Slides API
   - Google Calendar API
   - (find each in APIs & Services → Library)

4. Go to APIs & Services → OAuth consent screen:
   - User type: External
   - App name: Bruce
   - User support email: your email
   - Add your email to Test users (important — keeps it private during build)
   - Add scopes:
     - `../auth/userinfo.email`
     - `../auth/userinfo.profile`
     - `../auth/drive.file`
     - `../auth/documents`
     - `../auth/spreadsheets`
     - `../auth/presentations`
     - `../auth/calendar`

5. Go to APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID:
   - Application type: Web application
   - Name: Bruce Web
   - Authorized redirect URIs: add `https://your-project.supabase.co/auth/v1/callback`
     (replace with your actual Supabase project URL)
   - Also add `http://localhost:3000/auth/callback` for local dev
   - Copy the Client ID and Client Secret

**In Supabase:**

1. Authentication → Providers → Google
2. Toggle Google on
3. Paste the Client ID and Client Secret from above
4. Save

---

## Step 4 — Local Development Setup

```bash
# Install dependencies
npm install

# Create your local env file
cp .env.example .env.local
```

Open `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — from step 2
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from step 2
- `SUPABASE_SERVICE_ROLE_KEY` — from step 2
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `NEXT_PUBLIC_APP_URL` — `http://localhost:3000` for local
- `ADMIN_EMAIL` — your Google email address (gets admin role on first login)
- Firebase vars — leave blank for now, Phase 4

```bash
# Run dev server
npm run dev
```

Open `http://localhost:3000` — you should be redirected to `/login`.
Click Continue with Google — completes OAuth — redirects back to `/chat`.

**Verify first login:**
- Go to Supabase → Table Editor → users
- You should see your row with role = 'admin'
- The household table should have the seed record

---

## Step 5 — Vercel Deployment

1. Go to [vercel.com](https://vercel.com) → Add New Project
2. Import your GitHub `bruce` repo
3. Framework preset: Next.js (auto-detected)
4. Set environment variables — paste all vars from `.env.local`:
   - Change `NEXT_PUBLIC_APP_URL` to `https://bruce.app`
5. Deploy

Vercel will auto-deploy every push to `main` from here on.

**Add the Vercel callback URI to Google OAuth:**
- Go back to Google Cloud → Credentials → your OAuth client
- Add `https://bruce.app/auth/callback` to authorized redirect URIs
- Also update Supabase's Google provider redirect URI if needed

---

## Step 6 — bruce.app Domain

1. Go to wherever bruce.app is registered (or register it)
2. In Vercel → your project → Settings → Domains
3. Add `bruce.app`
4. Vercel will give you DNS records — add them to your registrar
5. SSL provisions automatically (~5 minutes)

Test: open `https://bruce.app` — should work identically to local.

---

## Step 7 — DigitalOcean Background Server

Phase 1 only needs the server provisioned and accessible.
Background jobs (memory hygiene, morning summary cron) activate in Phase 5.

1. Create a new Droplet:
   - Size: Basic / Regular Intel — $6/month
   - Region: same as Supabase
   - OS: Ubuntu 24.04 LTS
   - Authentication: SSH key (add your key)
   - Hostname: `bruce-bg`

2. SSH in and run initial setup:

```bash
ssh root@your-droplet-ip

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install PM2 for process management
npm install -g pm2

# Create service directory
mkdir -p /srv/bruce
```

3. Set your env vars on the server:

```bash
# Create env file
nano /srv/bruce/.env

# Paste:
SUPABASE_SERVICE_ROLE_KEY=your_key
NEXT_PUBLIC_SUPABASE_URL=your_url
ANTHROPIC_API_KEY=your_key
# (Firebase vars added in Phase 4)
```

This server is ready for Phase 5 background jobs. Nothing runs on it yet.

---

## Step 8 — Verify Deployment

Run through this checklist:

- [ ] `https://bruce.app` opens and redirects to login
- [ ] Google OAuth completes and creates a user row in Supabase
- [ ] User row has `role = 'admin'` for Jake's email
- [ ] Household seed record exists in the household table
- [ ] Pushing to GitHub → Vercel auto-deploys
- [ ] No errors in Vercel logs
- [ ] DigitalOcean droplet accessible via SSH

---

## Phase 1 Complete

**What exists now:**
- Supabase project with full schema and RLS enforced on every table
- Google OAuth working — single sign-in button, no passwords
- User creation on first login with correct role assignment
- Auto-deploy pipeline: GitHub → Vercel → bruce.app
- DigitalOcean server provisioned for background jobs
- PWA manifest and service worker hooks in place
- All Bruce design tokens defined in globals.css

**What comes next — Phase 2:**
- Private standalone chat interface
- Anthropic API integration with streaming
- Chat history stored and displayed in sidebar
- Basic personal memory generation
- Welcome screen with personalized greeting
- Incognito mode toggle

Open the Phase 2 chat and pick up from here.
