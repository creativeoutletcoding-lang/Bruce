/**
 * Native Google OAuth via ASWebAuthenticationSession — OAuth spike (branch: spike/oauth-native).
 *
 * Google blocks OAuth inside embedded webviews ("disallowed_useragent") AND rejects
 * custom URL schemes for sensitive scopes. The previous approach (SFSafariViewController
 * via @capacitor/browser + Universal Link callback) failed because iOS will not route a
 * Universal Link back to the app that presented an SFVC. The fix is ASWebAuthenticationSession,
 * which intercepts the callback URL internally before iOS processes it. We:
 *   1. ask Supabase to build the consent URL (skipBrowserRedirect — don't navigate
 *      the webview), which also sets the PKCE code-verifier cookie on heybruce.app,
 *   2. hand the URL to the native OAuthPlugin (ASWebAuthenticationSession), which
 *      opens the consent screen and intercepts the https://heybruce.app/auth/native-callback
 *      redirect directly — returning the full callback URL to JS without any appUrlOpen,
 *   3. extract the code and navigate the webview to /auth/native-callback?code=…, whose
 *      page calls completeNativeOAuth(). The browser client's detectSessionInUrl performs
 *      ONE PKCE exchange on init; completeNativeOAuth only waits for the session
 *      (it must not exchange again — that would consume the verifier twice).
 */
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { registerPlugin } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";
import { NATIVE_OAUTH_CALLBACK_URL } from "./index";

interface OAuthPluginInterface {
  openForCallback(options: { url: string }): Promise<{ callbackUrl: string }>;
}

const OAuthPlugin = registerPlugin<OAuthPluginInterface>("OAuthPlugin");

/**
 * Open the OAuth consent URL via ASWebAuthenticationSession and return the full
 * callback URL (https://heybruce.app/auth/native-callback?code=…) once the user
 * completes or cancels the flow.
 */
async function openWithASWAS(url: string): Promise<string> {
  console.log("[native] openWithASWAS called, invoking OAuthPlugin");
  const result = await OAuthPlugin.openForCallback({ url });
  return result.callbackUrl;
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
  console.log("[native] nativeGoogleOAuth: got auth URL, calling openWithASWAS");

  // 2. Open the consent screen via ASWebAuthenticationSession. The session intercepts
  //    the https://heybruce.app/auth/native-callback redirect internally and returns
  //    the full callback URL directly — no appUrlOpen listener needed.
  const callbackUrl = await openWithASWAS(data.url);

  // 3. Hand the code to the native-callback page.
  const code = new URL(callbackUrl).searchParams.get("code");
  if (!code) throw new Error("OAuth callback contained no authorization code");

  window.location.href = `/auth/native-callback?code=${encodeURIComponent(code)}`;
}

/** Options the web call already passes to signInWithOAuth (scopes, queryParams). */
export interface NativeOAuthOptions {
  scopes?: string;
  queryParams?: Record<string, string>;
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

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(session);
    });

    const timer = setTimeout(() => finish(null), timeoutMs);

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
  });
}
