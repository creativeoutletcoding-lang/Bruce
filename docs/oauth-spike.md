# OAuth Spike — Capacitor native shell + Google OAuth via system browser

Branch: `spike/oauth-native` · **Throwaway POC. Do not merge. Do not deploy to production.**

## What this spike proves

That Google OAuth works when Bruce runs inside a Capacitor iOS WKWebView shell
pointed at live heybruce.app, by routing OAuth through the **system browser** and
catching the callback via a **deep link** — for both:

1. **Supabase Auth login** (signing into Bruce), and
2. **Google connector token grants** (Calendar / Gmail / Drive authorization).

## Key audit finding — login and connector are the SAME flow

In this codebase there is **no separate per-user connector OAuth route**. Both
`app/login/page.tsx` and the settings "Reconnect Google" button
(`app/settings/GoogleReconnect.tsx`) call the same `supabase.auth.signInWithOAuth`,
requesting all connector scopes (Drive/Docs/Sheets/Slides/Calendar/Gmail) up front.
The server callback `app/auth/callback/route.ts` runs `exchangeCodeForSession` and
stores `session.provider_token` / `session.provider_refresh_token` into
`users.google_access_token / google_refresh_token / google_token_expires_at`.

So **one** native OAuth round-trip satisfies both verification goals.

> A third, out-of-scope OAuth path exists: `/api/admin/calendar-reauth` (admin-only,
> direct-Google, shared family calendar service account). Not touched by this spike.

## How the native path works

`lib/native/oauth.ts` → `nativeGoogleOAuth(supabase, options)`:

1. `signInWithOAuth({ ..., redirectTo: "app.heybruce://auth/callback", skipBrowserRedirect: true })`
   — builds the consent URL **and** writes the PKCE code-verifier cookie onto
   heybruce.app in the webview's cookie store.
2. `@capacitor/browser` opens that URL in the **system browser** (Google blocks
   OAuth in embedded webviews — `disallowed_useragent`).
3. `@capacitor/app` `appUrlOpen` catches `app.heybruce://auth/callback?code=…`.
4. The system browser is closed.
5. The webview navigates to the **existing** `/auth/callback?code=…` route. The
   verifier cookie travels with that navigation, so the server's
   `exchangeCodeForSession` succeeds exactly as on web — and the same route stores
   the connector tokens. **Login + connector grant in one shot.**

Everything is guarded by `isNative()` (`Capacitor.isNativePlatform()`), which is
**false in every browser** — the web/desktop paths are byte-for-byte unchanged.

PKCE: `@supabase/ssr@0.6.1` already defaults both clients to `flowType: "pkce"`.
`lib/supabase/client.ts` now states it explicitly (a no-op for web).

---

## ⚠️ Verification prerequisite — the shell must load this branch's code

`capacitor.config.ts` sets `server.url = https://heybruce.app`, which serves
**production** — and production does **not** contain this branch's native guards
(never merged/deployed). So to test on device you must point the shell at a build
that includes this branch. Pick one:

- **Vercel preview URL (recommended).** Pushing `spike/oauth-native` triggers an
  automatic Vercel **preview** deploy (this does NOT touch production/heybruce.app).
  Set `server.url` to that preview URL, then `npx cap copy ios`.
- **Local.** `npm run build && npm start`, then set `server.url` to
  `http://<your-LAN-IP>:3000` and set `server.cleartext: true` for that test only.

Remember to revert `server.url` back to `https://heybruce.app` afterward.

## Manual steps (do these before device testing — not done by the spike)

OAuth client: `350681764829-utdikj7tgvth8t2h3q3inj3ok3ous824.apps.googleusercontent.com`
(Google Cloud project `eternal-water-494204-m9`).

1. **Google Cloud Console → Credentials → that OAuth client → Authorized redirect URIs.**
   Add: `app.heybruce://auth/callback`
   (Note: Google's web OAuth client UI historically rejects custom schemes on "Web
   application" client types. If it does, this client may need an **iOS** OAuth
   client, or the redirect must stay an `https://` Universal Link. Surface this if
   the console blocks the custom scheme — it changes the approach.)
2. **Supabase → Authentication → URL Configuration → Redirect URLs.**
   Add: `app.heybruce://auth/callback`
3. **Xcode** (`ios/App/App.xcworkspace` — or open `ios/App` in Xcode):
   - Signing & Capabilities → select your Team; Bundle Identifier `app.heybruce.shell`.
   - Confirm URL scheme `app.heybruce` is present (already added to
     `ios/App/App/Info.plist` → `CFBundleURLTypes`).
   - Build to a **physical iPhone** (system-browser OAuth won't behave on simulator
     the same way; use a real device).

## Verification — what to test on device (pass/fail)

**Test 1 — Supabase login**
1. Launch the shell → tap **Continue with Google**.
2. ✅ The **system browser** opens (Safari sheet), NOT an in-app webview.
3. Complete Google consent.
4. ✅ The deep link returns to the app; the in-app browser closes.
5. ✅ A Supabase session is established and Bruce loads **logged in**.

**Test 2 — Connector grant (Calendar)**
1. From the logged-in shell, go to Settings → **Reconnect Google** (or exercise a
   Calendar tool that needs the token).
2. ✅ System browser opens → consent → deep link returns.
3. ✅ `users.google_access_token` is populated; a Calendar action succeeds.

**Gate:** If **both** pass, the native OAuth mechanism is proven and the full shell
build is unblocked. If either fails, report the failure point so the next session
can diagnose:
- **browser open** — system browser never appeared (plugin / config issue),
- **callback capture** — consent finished but the app never received the deep link
  (URL scheme not registered in Info.plist, or redirect URI not authorized in
  Google/Supabase),
- **code exchange** — deep link captured but `/auth/callback` errored (PKCE verifier
  cookie missing in the webview, or redirect URL not in Supabase),
- **session handoff** — exchange succeeded but the app didn't load logged in
  (cookie/session propagation).
