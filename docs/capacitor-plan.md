# Capacitor Native Shell — Scope & Plan

Status: **Approved 2026-06-11. Sequenced behind web loose ends. §3 OAuth spike is the gate and runs first.** This is additive: it
wraps the existing web app in a native iOS shell and does not fork or replace
any Bruce code.

---

## 1. The model: remote-URL hybrid (not a bundled rewrite)

The native shell is a **WKWebView pointed at the live Vercel URL** (`https://heybruce.app`),
not a bundle of static assets. Consequence:

- **Every UI / logic / tool / prompt change still ships via `git push` to main.**
  Vercel deploys it; the native app picks it up on next load. No rebuild.
- **The native shell is rebuilt only when native capability changes** — push
  setup, keyboard config, biometric, plugin versions. Rare.

So this preserves ~95% of the current deploy velocity. The native project is a
thin host, version-controlled in-repo under `ios/` + a `capacitor.config.ts`.

```ts
// capacitor.config.ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.heybruce.shell",
  appName: "Bruce",
  webDir: "public",            // minimal — real content is the remote URL
  server: {
    url: "https://heybruce.app",
    cleartext: false,
  },
  ios: { contentInset: "never" },
};
export default config;
```

`window.Capacitor` is auto-injected into the remote page, so the web code can
feature-detect native context with `Capacitor.isNativePlatform()`.

---

## 2. What it fixes (mapped to current hacks)

| Current PWA hack | Native replacement | Net change |
|---|---|---|
| `hooks/useVisualViewportLock.ts` (offsetTop tracking, rAF coalesce, `--app-height`/`--vv-offset-top`/`--kb-safe-bottom`) | `@capacitor/keyboard` `setResizeMode({ mode: "native" })` — OS resizes the webview above the keyboard | **Delete the hook + the CSS vars.** Shell returns to `height: 100%`. |
| iOS form-assistant accessory bar (`^ / v / ✓`) — unfixable in PWA | `Keyboard.setAccessoryBarVisible({ isVisible: false })` + WKWebView `inputAccessoryView` override | **Bar gone.** The thing we chased twice. |
| Web FCM path in `lib/firebase/client.ts` (VAPID `getToken`, `firebase-messaging-sw.js`, permission timing dance in `ChatShell`) | `@capacitor-firebase/messaging` — native APNs token, same FCM backend | Branch on native; **keep web path for desktop/Android browser.** |
| `pagehide`/unmount keepalive memory save in `useChatMemory.ts` (iOS kills pages without unmounting) | `@capacitor/app` `pause` listener — reliable lifecycle hook | Keep pagehide as web fallback; native gets a **reliable** save trigger. |
| `localStorage` flags (`notifications_prompted`) subject to 7-day Safari eviction | `@capacitor/preferences` durable store | More durable; web keeps localStorage. |
| No app lock at all on Gmail/Calendar/Drive tokens + family memory | Biometric plugin gates app open | **New capability — the strongest single reason to do this.** |

---

## 3. ⚠️ The one thing that will block this if missed: Google OAuth in WKWebView

**Google refuses OAuth inside embedded webviews** (`disallowed_useragent`).
Bruce uses Google OAuth for *both* Supabase Auth login **and** the
Calendar/Gmail/Drive connector token grants. Loaded naively in the shell's
WKWebView, **sign-in and connector auth will fail.**

Mitigation (required, not optional):

- Route every Google OAuth flow through the **system browser**, not the app
  WKWebView — `ASWebAuthenticationSession` via `@capacitor/browser`.
- Use a **deep link / universal link** as the OAuth redirect target
  (`app.heybruce://auth/callback` or an `applinks:` universal link).
- Capture the callback with `@capacitor/app` `appUrlOpen`, hand the code back
  to Supabase (**PKCE flow**) to complete the session.
- Supabase has a documented native deep-link OAuth pattern; the connector
  grants (`/api/...` Google token exchange) need the same external-browser
  treatment.

This is the single biggest piece of real work in the project. Everything else
is wiring. Budget accordingly.

---

## 4. Web-app code changes (small, branch-guarded)

Add `lib/native/` — a thin adapter that **no-ops on web** and calls Capacitor
plugins on native, so nothing in the existing components changes shape:

- `lib/native/index.ts` — `isNative()`, lazy plugin imports.
- `lib/native/push.ts` — native registration → POST existing
  `/api/notifications/register` with the APNs/FCM token (reuses
  `user_fcm_tokens` + `notifyUser()` fan-out **unchanged**).
- `lib/native/keyboard.ts` — resize mode + hide accessory bar on launch.
- `lib/native/biometric.ts` — `authenticate()` gate, called by `ChatShell` on
  resume.

Guarded edits:
- `ChatShell` — on native, skip the web-FCM permission banner; call keyboard
  setup + biometric gate instead.
- `useVisualViewportLock` — early-return (or unmount) when `isNative()`; delete
  once native is the only mobile target.
- `lib/firebase/client.ts` — branch the token path.

No changes to streaming, memory architecture, RLS, tools, or realtime.

---

## 5. Backend changes

Near-zero. The native push token still lands in `user_fcm_tokens` via the
existing register route; `notifyUser()` already fans out to all tokens and
prunes stale ones. If using `@capacitor-firebase/messaging`, FCM keeps handling
APNs delivery — **no APNs sender code to write.** Only add: an APNs auth key
(`.p8`) uploaded to the Firebase project.

---

## 6. Prerequisites you provide (I can't do these)

- **Apple Developer account** ($99/yr) — for signing, push entitlement, TestFlight.
- **Xcode** on the Mac (you're on darwin — fine) + CocoaPods.
- **A physical iPhone** for push testing — APNs does not work in the simulator.
- **APNs auth key (.p8)** generated in the Apple Developer portal, uploaded to
  Firebase Cloud Messaging settings.
- A bundle identifier decision (suggested `app.heybruce.shell`).

---

## 7. Setup steps (once prereqs exist)

```bash
# 1. Install Capacitor + plugins
npm i @capacitor/core @capacitor/cli @capacitor/ios
npm i @capacitor/keyboard @capacitor/app @capacitor/browser \
      @capacitor/preferences @capacitor/status-bar @capacitor/splash-screen
npm i @capacitor-firebase/messaging
npm i @aparajita/capacitor-biometric-auth   # or capacitor-native-biometric

# 2. Init + add iOS (capacitor.config.ts from §1 first)
npx cap init Bruce app.heybruce.shell
npx cap add ios

# 3. Native config in Xcode:
#    - Signing team + bundle id
#    - Push Notifications capability + Background Modes (remote notifications)
#    - GoogleService-Info.plist from Firebase (iOS app)
#    - URL scheme app.heybruce + associated-domains for universal links
#    - Override inputAccessoryView -> nil in the WKWebView subclass

# 4. Sync + open
npx cap sync ios
npx cap open ios   # build/run on device from Xcode
```

---

## 8. Distribution to the household

- **TestFlight** — easiest for 6 people incl. Nana/Grampy. Caveat: builds
  expire at **90 days**; you re-upload a build periodically (the *web* content
  still updates live in between — only the shell build expires).
- Or **ad-hoc / sideload** via Xcode for registered device UDIDs (no 90-day
  TestFlight expiry, but manual per device).
- Not App Store — and good, because Apple often rejects "just a website"
  wrappers. Private household distribution sidesteps review entirely.

---

## 9. Why this is reversible / low-risk

- The web app keeps working as a PWA throughout — the shell is purely additive.
- All native code is branch-guarded behind `isNative()`; web/desktop/Android
  paths are untouched.
- If the shell is abandoned, delete `ios/`, `capacitor.config.ts`, and
  `lib/native/`; the PWA is exactly as it was.

---

## 10. Effort estimate

| Piece | Relative effort |
|---|---|
| Capacitor init + remote-URL config + plugins | small |
| Keyboard (resize + kill accessory bar) | small |
| Native push wired to existing register route | small–medium |
| **Google OAuth via system browser + deep-link callback (§3)** | **medium–large — the real work** |
| Biometric gate | small |
| Xcode signing / push entitlement / TestFlight | small but fiddly, one-time |

The honest takeaway: the win/effort ratio is excellent *except* for the Google
OAuth-in-webview problem, which is the gate. Solve §3 first as a spike before
committing to the rest.
