# Google OAuth Setup

Required configuration for Google Drive integration in Bruce.

---

## Google Cloud Console

### 1. Create or select a project

Go to [console.cloud.google.com](https://console.cloud.google.com) and select
or create a project (e.g., "Bruce Household AI").

### 2. Enable required APIs

Navigate to **APIs & Services → Library** and enable:

- Google Drive API
- Google Docs API
- Google Sheets API
- Google Slides API
- Google Calendar API

### 3. Configure the OAuth consent screen

Navigate to **APIs & Services → OAuth consent screen**.

- User type: **External** (or Internal if using Google Workspace)
- App name: `Bruce`
- Support email: your email
- Authorized domain: `heybruce.app`

**Scopes** — add all of these:

| Scope | Purpose |
|-------|---------|
| `https://www.googleapis.com/auth/drive.file` | Read/write files Bruce creates — NOT the user's whole Drive |
| `https://www.googleapis.com/auth/documents` | Read and write Google Docs |
| `https://www.googleapis.com/auth/spreadsheets` | Read and write Google Sheets |
| `https://www.googleapis.com/auth/presentations` | Read and write Google Slides |
| `https://www.googleapis.com/auth/calendar` | Read and write Google Calendar (Phase 5) |

> **Note on `drive.file`:** This scope is intentionally narrow. Bruce can only
> access files it created or that the user explicitly shared with it. It cannot
> browse the user's entire Drive. This is by design.

### 4. Create OAuth credentials

Navigate to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.

- Application type: **Web application**
- Name: `Bruce`
- Authorized JavaScript origins:
  - `http://localhost:3000`
  - `https://heybruce.app`
- Authorized redirect URIs:
  - `https://<your-project-ref>.supabase.co/auth/v1/callback`
  - (Supabase handles the callback, not the Next.js app directly)

Copy the **Client ID** and **Client Secret** into your `.env.local`:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 5. Publishing status

While the app is in testing, add test users in the OAuth consent screen.
Add all household members' Google accounts before they log in.
When ready to go beyond 100 users, submit for Google verification (not needed
for a private household app — test mode is sufficient).

---

## Supabase Dashboard

### Configure the Google provider

Navigate to **Authentication → Providers → Google**.

- **Enable**: toggle on
- **Client ID**: paste from Google Cloud Console
- **Client Secret**: paste from Google Cloud Console
- **Redirect URL**: this is auto-filled — copy it and add it to Google Cloud
  Console's authorized redirect URIs (it looks like
  `https://<ref>.supabase.co/auth/v1/callback`)

### Scopes

The OAuth scopes are passed in code (`app/login/page.tsx` and `app/join/page.tsx`),
not in the Supabase dashboard. The dashboard only needs the Client ID and Secret.

The `access_type=offline` and `prompt=consent` parameters that force Google to
issue a refresh token are also passed in code. No dashboard configuration needed.

---

## Vercel environment variables

In the Vercel dashboard under **Settings → Environment Variables**, add:

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

These are not currently used directly in the application code (tokens come
through Supabase OAuth), but are documented here for reference if direct
Google API calls are added in the future.

---

## How the token flow works

1. User logs in via Google OAuth (Supabase handles the OAuth dance)
2. Supabase returns `provider_token` (access token) and `provider_refresh_token`
   in the session
3. `app/auth/callback/route.ts` extracts both tokens and stores them in the
   `users` table via service role
4. `lib/google/drive.ts` reads the stored tokens, refreshing automatically when
   within 5 minutes of expiry
5. Refreshed tokens are written back to the `users` table immediately

The tokens give Bruce access to Google Drive files it creates — no broader
Drive access, consistent with the `drive.file` scope.
