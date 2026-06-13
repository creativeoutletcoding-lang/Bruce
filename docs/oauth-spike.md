# OAuth Spike — Capacitor native shell + Google OAuth via system browser

Branch: `spike/oauth-native` · **Status: SUCCESSFUL — native OAuth via ASWebAuthenticationSession proven end-to-end on device. This is the production-ready foundation for the Capacitor shell.**

> ✅ **Associated Domains are production-ready.** `ios/App/App/App.entitlements`
> lists the standard `applinks:heybruce.app` and `webcredentials:heybruce.app`
> (no `?mode=developer` suffix). The temporary `?mode=developer` workaround — which
> forced `swcd` to fetch the AASA from our origin while Apple's CDN served a stale
> cache, and only worked on a device with Settings → Developer → Associated Domains
> Development enabled — has been removed now that Apple's CDN has refreshed. The
> webcredentials-bearing AASA is confirmed live at
> `app-site-association.cdn-apple.com/a/v1/heybruce.app` with appID
> `3ZL5564832.app.heybruce.shell`, so the plain entitlement validates in
> production / TestFlight / App Store builds.

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

## Callback transport: Universal Link (not custom scheme)

Google's web OAuth client **rejects custom URL schemes** (`app.heybruce://`) for
sensitive scopes. So the callback is now an **https Universal Link**:
`https://heybruce.app/auth/native-callback`. iOS routes that URL into the app
(instead of opening it in Safari) when two things are true:

- the device has the **Associated Domains** entitlement `applinks:heybruce.app`
  (manual Xcode step), AND
- **heybruce.app** serves a valid **Apple App Site Association** file at
  `/.well-known/apple-app-site-association` naming this app + path.

The AASA file is committed at `public/.well-known/apple-app-site-association`:
`appID` = `3ZL5564832.app.heybruce.shell`, `paths` = `["/auth/native-callback"]`,
plus a `webcredentials` entry naming the same appID.
It must be served as `application/json`, over https, **with no redirect** — so:
- `next.config.js` forces `Content-Type: application/json` on that exact path, and
- `middleware.ts` excludes `/.well-known/` from the auth gate (otherwise an
  unauthenticated fetch 307-redirects to `/login` and Universal Links fail to
  validate — both the matcher and the `isPublic` list were updated).

## How the native path works

`lib/native/oauth.ts` → `nativeGoogleOAuth(supabase, options)`:

1. `signInWithOAuth({ ..., redirectTo: "https://heybruce.app/auth/native-callback", skipBrowserRedirect: true })`
   — builds the consent URL **and** writes the PKCE code-verifier cookie onto
   heybruce.app in the webview's cookie store.
2. `@capacitor/browser` opens that URL in the **system browser** (Google blocks
   OAuth in embedded webviews — `disallowed_useragent`).
3. `@capacitor/app` `appUrlOpen` catches the Universal Link
   `https://heybruce.app/auth/native-callback?code=…` (Universal Links arrive
   through the same `appUrlOpen` event as custom-scheme deep links).
4. The system browser is closed.
5. The webview navigates to `/auth/native-callback?code=…`. That page
   (`app/auth/native-callback/page.tsx`) calls `completeNativeOAuth(code)`, which
   finishes the **PKCE exchange client-side** (`exchangeCodeForSession` — the
   verifier cookie survives the reload), then POSTs the connector tokens to
   `/api/native/google-tokens` so server-side tools can use them. On web this page
   harmlessly redirects to `/chat` — never a dead end.

> Why client-side exchange + a token endpoint, vs. the previous "navigate to the
> server `/auth/callback`" approach: the Universal Link's `code` is captured in the
> app, and the page completes the exchange directly per the iteration spec. Since
> that bypasses the server callback (which normally stores provider tokens), the
> tiny native-only `POST /api/native/google-tokens` mirrors that one DB write —
> authenticated by the session the exchange just established, own-row only.

Everything is guarded by `isNative()` (`Capacitor.isNativePlatform()`), which is
**false in every browser** — the web/desktop paths are byte-for-byte unchanged.

PKCE: `@supabase/ssr@0.6.1` already defaults both clients to `flowType: "pkce"`.
`lib/supabase/client.ts` now states it explicitly (a no-op for web).

> The custom URL scheme `app.heybruce` is still registered in `Info.plist` from the
> first iteration but is now **unused** for OAuth — harmless to leave.

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

### The AASA-on-production question (flagging, not deciding)

Two domains are in play and they are NOT the same:
- the **webview content** can load from a preview URL (the `server.url` override above), but
- the **Universal Link** validates `apple-app-site-association` against the literal
  domain in `applinks:heybruce.app` → **production `https://heybruce.app`**.

So even when testing against a preview, iOS still fetches the AASA file from
`https://heybruce.app/.well-known/apple-app-site-association`, where it does **not
exist yet** (this branch isn't deployed to prod). Options, cleanest first:

- **Cherry-pick just the AASA file (+ the middleware/next.config changes that make
  it serve correctly) to `main` and deploy.** This is the cleanest way to get the
  file live on heybruce.app. It is a static JSON file naming an app that isn't on
  the App Store — it has **zero effect on the web app or existing users**, and it's
  the only piece that genuinely must be on production for Universal Links to work.
  The rest of the shell (Capacitor, native guards) can stay on the branch.
- **Point `applinks:` at the preview domain instead.** Possible but messy: the
  entitlement, the Google/Supabase redirect URIs, and the AASA `appID`/host would
  all have to match the preview domain, and preview URLs change per deployment.
  Not recommended.

**Recommendation:** ship only `public/.well-known/apple-app-site-association`, the
`next.config.js` header entry, and the `middleware.ts` `.well-known` exclusion to
production. Keep everything else on the branch. (Your call — flagging, not doing it.)

## Manual steps (do these before device testing — not done by the spike)

OAuth client: `350681764829-utdikj7tgvth8t2h3q3inj3ok3ous824.apps.googleusercontent.com`
(Google Cloud project `eternal-water-494204-m9`). Team ID `3ZL5564832`,
bundle id `app.heybruce.shell`.

1. **Google Cloud Console → Credentials → that OAuth client → Authorized redirect URIs.**
   Add: `https://heybruce.app/auth/native-callback`
   (https Universal Link — accepted by the web client; the custom scheme was not.)
2. **Supabase → Authentication → URL Configuration → Redirect URLs.**
   Add: `https://heybruce.app/auth/native-callback`
3. **Xcode** (open `ios/App` in Xcode):
   - Signing & Capabilities → select your Team; Bundle Identifier `app.heybruce.shell`.
   - **Add the "Associated Domains" capability** with entry: `applinks:heybruce.app`
     (this is what makes iOS hand the Universal Link to the app — the spike does NOT
     do this, it needs Xcode).
   - Build to a **physical iPhone** (Universal Links + system-browser OAuth do not
     behave on the simulator; use a real device).

4. **Host the AASA file at the PRODUCTION domain.** Universal Links validate the
   `apple-app-site-association` file against `https://heybruce.app` specifically —
   NOT against a preview URL. The file only exists on this branch, so it is not
   live on heybruce.app yet. See the next section for how to get it hosted without
   shipping the rest of the shell.

## Verification — what to test on device (pass/fail)

**Pre-check — AASA reachable:** in a browser, open
`https://heybruce.app/.well-known/apple-app-site-association`. ✅ It must return the
JSON (not a redirect, not a login page) with `Content-Type: application/json`. If it
404s or redirects, Universal Links cannot work — fix hosting first (see above).

**Test 1 — Supabase login**
1. Launch the shell → tap **Continue with Google**.
2. ✅ The **system browser** opens (Safari sheet), NOT an in-app webview.
3. Complete Google consent.
4. ✅ The Universal Link returns to the app (NOT opened in Safari); the in-app
   browser closes; the page shows "Signing you in…".
5. ✅ A Supabase session is established and Bruce loads **logged in**.

**Test 2 — Connector grant (Calendar)**
1. From the logged-in shell, go to Settings → **Reconnect Google** (or exercise a
   Calendar tool that needs the token).
2. ✅ System browser opens → consent → Universal Link returns.
3. ✅ `users.google_access_token` is populated (via `/api/native/google-tokens`); a
   Calendar action succeeds.

**Gate:** If **both** pass, the native OAuth mechanism is proven and the full shell
build is unblocked. If either fails, report the failure point so the next session
can diagnose:
- **AASA / link routing** — consent finished but Safari just *displayed*
  `/auth/native-callback` instead of handing it to the app (AASA not live on
  heybruce.app, `Content-Type` wrong, a redirect in the way, or the Associated
  Domains entitlement missing/mismatched),
- **browser open** — system browser never appeared (plugin / config issue),
- **callback capture** — Universal Link routed to the app but `appUrlOpen` never
  fired (entitlement or AppDelegate forwarding),
- **code exchange** — code captured but `completeNativeOAuth` /
  `exchangeCodeForSession` errored (PKCE verifier cookie missing in the webview, or
  redirect URL not authorized in Supabase),
- **token storage** — login worked but `/api/native/google-tokens` failed (session
  cookie not yet propagated when POSTed),
- **session handoff** — exchange succeeded but the app didn't load logged in
  (cookie/session propagation).
