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
 * Custom URL scheme + path that Google/Supabase redirect back to after consent.
 * The scheme `app.heybruce` must be registered in the iOS app's Info.plist
 * (CFBundleURLSchemes) and as an authorized redirect URI on the Google OAuth
 * client. See docs/oauth-spike.md for the manual registration steps.
 */
export const OAUTH_DEEP_LINK = "app.heybruce://auth/callback";

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
