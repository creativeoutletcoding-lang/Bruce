"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PageState =
  | { status: "loading" }
  | { status: "valid"; email: string | null }
  | { status: "invalid"; reason: string }
  | { status: "signing_in" };

function JoinContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const error = searchParams.get("error");

  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    if (error === "unauthorized") {
      setState({ status: "invalid", reason: "This invite link is required to create an account." });
      return;
    }
    if (error === "invalid_token") {
      setState({ status: "invalid", reason: "This invite link is invalid or has expired." });
      return;
    }
    if (error === "auth") {
      setState({ status: "invalid", reason: "Sign-in failed. Please try the link again." });
      return;
    }

    if (!token) {
      setState({ status: "invalid", reason: "No invite token found. Ask for a new invite link." });
      return;
    }

    fetch(`/api/admin/invites/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg =
            (body as { error?: string }).error === "Invite already used"
              ? "This invite link has already been used."
              : "This invite link is invalid or has expired.";
          setState({ status: "invalid", reason: msg });
          return;
        }
        const data = await res.json() as { email: string | null };
        setState({ status: "valid", email: data.email });
      })
      .catch(() => {
        setState({ status: "invalid", reason: "Unable to validate invite. Please try again." });
      });
  }, [token, error]);

  async function handleSignIn() {
    if (!token) return;
    setState({ status: "signing_in" });
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Embed the invite token in the redirectTo URL so the callback can read it
        redirectTo: `${window.location.origin}/auth/callback?invite_token=${encodeURIComponent(token)}`,
        scopes: [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/documents",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/presentations",
          "https://www.googleapis.com/auth/calendar",
        ].join(" "),
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
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

        {state.status === "loading" && (
          <p style={styles.message}>Validating invite…</p>
        )}

        {state.status === "invalid" && (
          <div style={styles.errorBanner} role="alert">
            {state.reason}
          </div>
        )}

        {state.status === "valid" && (
          <>
            <div style={styles.inviteBanner}>
              <p style={styles.inviteText}>
                {state.email
                  ? `You've been invited to join Bruce — ${state.email}`
                  : "You've been invited to join Bruce."}
              </p>
            </div>
            <button
              onClick={handleSignIn}
              style={styles.googleButton}
              disabled={false}
            >
              <GoogleIcon />
              <span>Continue with Google</span>
            </button>
          </>
        )}

        {state.status === "signing_in" && (
          <p style={styles.message}>Redirecting to Google…</p>
        )}
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinContent />
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
  message: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
    textAlign: "center",
  },
  errorBanner: {
    width: "100%",
    padding: "12px 16px",
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "var(--radius-sm)",
    color: "#dc2626",
    fontSize: "0.875rem",
    textAlign: "center",
    lineHeight: "1.5",
  },
  inviteBanner: {
    width: "100%",
    padding: "12px 16px",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "var(--radius-sm)",
    textAlign: "center",
  },
  inviteText: {
    fontSize: "0.9375rem",
    color: "var(--text-primary)",
    lineHeight: "1.5",
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
};
