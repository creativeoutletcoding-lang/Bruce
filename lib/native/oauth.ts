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
 *      completeNativeOAuth(). The browser client's detectSessionInUrl performs
 *      ONE PKCE exchange on init; completeNativeOAuth only waits for the session
 *      (it must not exchange again — that would consume the verifier twice).
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
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
 * Finish the PKCE flow from the native-callback page, then persist the Google
 * connector tokens so server-side tools can use them.
 *
 * IMPORTANT — single exchange only. The @supabase/ssr browser client has
 * `detectSessionInUrl` enabled, so simply creating it on the
 * /auth/native-callback?code=… page triggers exactly ONE deterministic PKCE
 * exchange during init (consuming the single-use code + verifier). We must NOT
 * call `exchangeCodeForSession` ourselves — that previously raced the
 * auto-exchange and threw on the already-consumed verifier, surfacing a false
 * "Sign in failed" even though the session was established. Instead we just wait
 * for the session the auto-exchange produces.
 */
export async function completeNativeOAuth(): Promise<void> {
  const supabase = createClient();

  // Wait for the session the detectSessionInUrl auto-exchange produces.
  const session = await waitForSession(supabase);
  if (!session) {
    throw new Error("native OAuth: no session after callback auto-exchange");
  }

  // Persist provider tokens (Calendar/Gmail/Drive). The web flow does this in the
  // server /auth/callback route; the native path bypasses it, so mirror it here.
  // The one-time provider_token/refresh ride on the SIGNED_IN session captured
  // below. Best-effort — a storage failure must not block a successful login.
  const accessToken = session.provider_token ?? null;
  const refreshToken = session.provider_refresh_token ?? null;
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

/**
 * Resolve with the session produced by the detectSessionInUrl auto-exchange.
 * `onAuthStateChange` delivers SIGNED_IN (carrying the one-time provider tokens);
 * `getSession()` is the fallback in case the exchange settled before we
 * subscribed. Resolves null if no session appears within the timeout (a genuine
 * auth failure — e.g. the auto-exchange errored on a bad/expired code).
 */
function waitForSession(
  supabase: SupabaseClient,
  timeoutMs = 15000
): Promise<Session | null> {
  return new Promise<Session | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(session);
    });

    function finish(session: Session | null) {
      if (settled) return;
      settled = true;
      subscription.unsubscribe();
      clearTimeout(timer);
      resolve(session);
    }

    // The auto-exchange may have already settled before we subscribed; getSession
    // awaits client init (including the exchange) and returns the result.
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish(data.session);
    });

    timer = setTimeout(() => finish(null), timeoutMs);
  });
}
