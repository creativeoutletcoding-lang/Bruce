"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  async function handleGoogleSignIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/documents",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/presentations",
          "https://www.googleapis.com/auth/calendar",
        ].join(" "),
      },
    });
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.wordmark}>Bruce</h1>
          <p style={styles.subtitle}>Johnson Household</p>
        </div>

        {error && (
          <div style={styles.errorBanner} role="alert">
            Sign-in failed. Please try again.
          </div>
        )}

        <button onClick={handleGoogleSignIn} style={styles.googleButton}>
          <GoogleIcon />
          <span>Continue with Google</span>
        </button>

        <p style={styles.inviteNote}>Invitation required</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
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
  card: {
    width: "100%",
    maxWidth: "360px",
    backgroundColor: "var(--bg-primary)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border)",
    padding: "40px 32px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "24px",
    boxShadow: "var(--shadow-md)",
  },
  header: {
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  wordmark: {
    fontSize: "2rem",
    fontWeight: "700",
    letterSpacing: "-0.03em",
    color: "var(--text-primary)",
  },
  subtitle: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
    fontWeight: "400",
  },
  errorBanner: {
    width: "100%",
    padding: "10px 14px",
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "var(--radius-sm)",
    color: "#dc2626",
    fontSize: "0.875rem",
    textAlign: "center",
  },
  googleButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "11px 16px",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    color: "var(--text-primary)",
    fontSize: "0.9375rem",
    fontWeight: "500",
    transition: "background-color var(--transition), border-color var(--transition)",
    cursor: "pointer",
  },
  inviteNote: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
  },
};
