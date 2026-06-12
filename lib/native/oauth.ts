/**
 * Native Google OAuth via the system browser — OAuth spike (branch: spike/oauth-native).
 *
 * Google blocks OAuth inside embedded webviews ("disallowed_useragent") AND rejects
 * custom URL schemes for sensitive scopes, so the consent screen opens in the system
 * browser and the callback is an https Universal Link. We:
 *   1. ask Supabase to build the consent URL (skipBrowserRedirect — don't navigate
 *      the webview), which also sets the PKCE code-verifier cookie on heybruce.app,
 *   2. open that URL in the system browser,
 *   3. catch the `https://heybruce.app/auth/native-callback?code=…` Universal Link
 *      the OS routes back into the app (still via @capacitor/app appUrlOpen),
 *   4. close the system browser, and
 *   5. navigate the webview to /auth/native-callback?code=…, whose page calls
 *      completeNativeOAuth() to finish the PKCE exchange client-side.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { NATIVE_OAUTH_CALLBACK_URL, loadApp, loadBrowser } from "./index";

/** Options the web call already passes to signInWithOAuth (scopes, queryParams). */
export interface NativeOAuthOptions {
  scopes?: string;
  queryParams?: Record<string, string>;
}

/** Open a URL in the OS browser (Safari View Controller on iOS), not the in-app webview. */
export async function openSystemBrowser(url: string): Promise<void> {
  const Browser = await loadBrowser();
  await Browser.open({ url });
}

/** Dismiss the system browser. Best-effort — never throws. */
export async function closeSystemBrowser(): Promise<void> {
  try {
    const Browser = await loadBrowser();
    await Browser.close();
  } catch {
    /* browser may already be closed by the user */
  }
}

/**
 * Resolve with the full callback URL the first time the OS routes the Universal
 * Link back into the app. One-shot: removes its own listener. Universal Links and
 * custom-scheme deep links both arrive through @capacitor/app `appUrlOpen`.
 */
export async function waitForOAuthCallback(): Promise<string> {
  const App = await loadApp();
  return new Promise<string>((resolve) => {
    const handlePromise = App.addListener("appUrlOpen", (event: { url: string }) => {
      if (event.url && event.url.startsWith(NATIVE_OAUTH_CALLBACK_URL)) {
        handlePromise.then((handle) => handle.remove());
        resolve(event.url);
      }
    });
  });
}

/**
 * Full native Google OAuth round-trip. Throws on failure so callers can surface it.
 * On success it navigates the webview to /auth/native-callback and never returns.
 */
export async function nativeGoogleOAuth(
  supabase: SupabaseClient,
  options: NativeOAuthOptions
): Promise<void> {
  // 1. Build the consent URL without redirecting the webview. This also writes the
  //    PKCE code-verifier cookie onto heybruce.app in the webview's cookie store.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      ...options,
      redirectTo: NATIVE_OAUTH_CALLBACK_URL,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("signInWithOAuth returned no consent URL");

  // 2. Arm the Universal Link listener BEFORE opening the browser (avoid a race).
  const callbackPromise = waitForOAuthCallback();

  // 3. Open the consent screen in the system browser.
  await openSystemBrowser(data.url);

  // 4. Wait for Google → https://heybruce.app/auth/native-callback?code=…
  const callbackUrl = await callbackPromise;

  // 5. Close the in-app browser and hand the code to the native-callback page.
  await closeSystemBrowser();

  const code = new URL(callbackUrl).searchParams.get("code");
  if (!code) throw new Error("OAuth callback contained no authorization code");

  window.location.href = `/auth/native-callback?code=${encodeURIComponent(code)}`;
}

/**
 * Finish the PKCE flow from the native-callback page: exchange the code for a
 * Supabase session client-side (the verifier cookie set in step 1 above survives
 * the reload), then persist the Google connector tokens so server-side tools can
 * use them. Returns when the session is established; the caller routes onward.
 */
export async function completeNativeOAuth(code: string): Promise<void> {
  const supabase = createClient();

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  if (!data.session) throw new Error("exchangeCodeForSession returned no session");

  // Persist provider tokens (Calendar/Gmail/Drive). The web flow does this in the
  // server /auth/callback route; the native path bypasses it, so mirror it here.
  // Best-effort — a storage failure must not block an otherwise-successful login.
  const accessToken = data.session.provider_token ?? null;
  const refreshToken = data.session.provider_refresh_token ?? null;
  if (accessToken || refreshToken) {
    try {
      await fetch("/api/native/google-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
      });
    } catch {
      /* non-fatal: session is established; connector tokens can be re-granted */
    }
  }
}
