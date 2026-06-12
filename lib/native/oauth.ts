/**
 * Native Google OAuth via the system browser — OAuth spike (branch: spike/oauth-native).
 *
 * Google blocks OAuth inside embedded webviews ("disallowed_useragent"), so the
 * consent screen MUST open in the system browser. We:
 *   1. ask Supabase to build the consent URL (skipBrowserRedirect — don't navigate
 *      the webview), which also sets the PKCE code-verifier cookie on heybruce.app,
 *   2. open that URL in the system browser,
 *   3. catch the `app.heybruce://auth/callback?code=…` deep link the OS hands back,
 *   4. close the system browser, and
 *   5. navigate the webview to the EXISTING /auth/callback server route with the code.
 *
 * Step 5 reuses the production callback verbatim: the verifier cookie travels with
 * the navigation, so the server's exchangeCodeForSession succeeds exactly as on web,
 * AND the same route stores the Google connector tokens (Calendar/Gmail/Drive). One
 * round-trip = Supabase login + connector grant, because in this codebase they are
 * the same OAuth flow.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { OAUTH_DEEP_LINK, loadApp, loadBrowser } from "./index";

/** Options the web call already passes to signInWithOAuth (scopes, queryParams, redirectTo). */
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
 * Resolve with the full deep-link callback URL the first time the OS routes one
 * matching our scheme back into the app. One-shot: removes its own listener.
 */
export async function waitForOAuthCallback(): Promise<string> {
  const App = await loadApp();
  return new Promise<string>((resolve) => {
    const handlePromise = App.addListener("appUrlOpen", (event: { url: string }) => {
      if (event.url && event.url.startsWith(OAUTH_DEEP_LINK)) {
        handlePromise.then((handle) => handle.remove());
        resolve(event.url);
      }
    });
  });
}

/**
 * Full native Google OAuth round-trip. Throws on failure so callers can surface it.
 * On success it navigates the webview to /auth/callback and never returns control.
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
      redirectTo: OAUTH_DEEP_LINK,
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("signInWithOAuth returned no consent URL");

  // 2. Arm the deep-link listener BEFORE opening the browser (avoid a race).
  const callbackPromise = waitForOAuthCallback();

  // 3. Open the consent screen in the system browser.
  await openSystemBrowser(data.url);

  // 4. Wait for Google → app.heybruce://auth/callback?code=…
  const callbackUrl = await callbackPromise;

  // 5. Close the in-app browser and hand the code to the existing server callback.
  await closeSystemBrowser();

  const code = new URL(callbackUrl).searchParams.get("code");
  if (!code) throw new Error("OAuth callback contained no authorization code");

  window.location.href = `/auth/callback?code=${encodeURIComponent(code)}`;
}
