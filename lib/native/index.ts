/**
 * Native-shell adapter — OAuth spike (branch: spike/oauth-native).
 *
 * Everything here is a no-op in a normal browser: `isNative()` is false, so the
 * web/desktop code paths are never touched. Capacitor plugins are loaded lazily
 * via dynamic import so they stay out of the SSR/web bundle entry path.
 */
import { Capacitor } from "@capacitor/core";

/** True only inside the Capacitor iOS WKWebView shell. False in every browser. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Universal Link that Google/Supabase redirect back to after consent.
 *
 * Google's web OAuth client rejects custom URL schemes for sensitive scopes, so
 * the callback is an https Universal Link instead of `app.heybruce://`. iOS routes
 * this URL into the app (via @capacitor/app `appUrlOpen`) when the device has the
 * Associated Domains entitlement `applinks:heybruce.app` AND heybruce.app serves a
 * valid /.well-known/apple-app-site-association naming this path. See
 * docs/oauth-spike.md for the manual registration steps.
 */
export const NATIVE_OAUTH_CALLBACK_URL = "https://heybruce.app/auth/native-callback";

/** Lazy loader for @capacitor/browser (system browser, not the in-app webview). */
export async function loadBrowser() {
  const { Browser } = await import("@capacitor/browser");
  return Browser;
}

/** Lazy loader for @capacitor/app (deep-link / appUrlOpen events). */
export async function loadApp() {
  const { App } = await import("@capacitor/app");
  return App;
}
