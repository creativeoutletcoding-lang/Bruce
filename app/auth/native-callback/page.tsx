"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isNative } from "@/lib/native";
import { completeNativeOAuth } from "@/lib/native/oauth";

/**
 * Universal Link target for native Google OAuth (https://heybruce.app/auth/native-callback).
 *
 * On native: the shell navigates here with `?code=…` after catching the Universal
 * Link; we finish the PKCE exchange client-side and route into the logged-in app.
 * On web: this route should never be hit directly, so we harmlessly send the
 * browser to the normal post-login destination (middleware will bounce to /login
 * if there is no session) — never a dead end.
 */
function NativeCallbackContent() {
  const router = useRouter();
  // StrictMode/double-mount guard: exchangeCodeForSession consumes a single-use code.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (!isNative()) {
      router.replace("/chat");
      return;
    }

    // No code in the URL → nothing to exchange; bounce to login.
    if (!new URLSearchParams(window.location.search).has("code")) {
      router.replace("/login?error=auth");
      return;
    }

    // completeNativeOAuth relies on the client's detectSessionInUrl auto-exchange
    // (it reads ?code= from this URL itself) — we don't pass or re-exchange the code.
    completeNativeOAuth()
      .then(() => router.replace("/chat"))
      .catch(() => router.replace("/login?error=auth"));
  }, [router]);

  return (
    <div style={styles.container}>
      <p style={styles.text}>Signing you in…</p>
    </div>
  );
}

export default function NativeCallbackPage() {
  return (
    <Suspense
      fallback={
        <div style={styles.container}>
          <p style={styles.text}>Signing you in…</p>
        </div>
      }
    >
      <NativeCallbackContent />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    backgroundColor: "var(--bg-secondary)",
  },
  text: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
  },
};
