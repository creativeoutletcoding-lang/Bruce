"use client";

import { createClient } from "@/lib/supabase/client";

export default function LandingPage() {
  async function handleSignIn() {
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
          "https://mail.google.com/",
        ].join(" "),
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  }

  const currentYear = new Date().getFullYear();

  return (
    <div style={styles.page}>
      <main style={styles.main}>
        <h1 style={styles.title}>Bruce</h1>
        <p style={styles.tagline}>A private AI for the Johnson family.</p>

        {/* Google branding guidelines: white button, exact text, Google logo */}
        <button onClick={handleSignIn} style={styles.googleButton}>
          <GoogleIcon />
          <span style={styles.googleButtonText}>Sign in with Google</span>
        </button>

        <p style={styles.inviteNote}>
          Invitation only. Access is limited to household members.
        </p>
      </main>

      <footer style={styles.footer}>
        <a href="/privacy" style={styles.footerLink}>
          Privacy Policy
        </a>
        <span style={styles.footerSep}>·</span>
        <span>{currentYear}</span>
      </footer>
    </div>
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
  page: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--bg-secondary)",
    padding: "40px 24px 24px",
    gap: "0",
  },
  main: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "20px",
    width: "100%",
    maxWidth: "400px",
  },
  title: {
    fontSize: "clamp(3rem, 10vw, 5rem)",
    fontWeight: "700",
    letterSpacing: "-0.04em",
    color: "var(--text-primary)",
    lineHeight: "1",
  },
  tagline: {
    fontSize: "1.0625rem",
    color: "var(--text-secondary)",
    fontWeight: "400",
    textAlign: "center",
    lineHeight: "1.5",
  },
  // Per Google branding guidelines: always white background, dark text
  googleButton: {
    marginTop: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    padding: "0 12px",
    height: "44px",
    backgroundColor: "#ffffff",
    border: "1px solid #dadce0",
    borderRadius: "4px",
    color: "#3c4043",
    fontSize: "0.9375rem",
    fontWeight: "500",
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
    boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
    transition: "background-color 150ms ease, box-shadow 150ms ease",
  },
  googleButtonText: {
    color: "#3c4043",
    fontSize: "0.9375rem",
    fontWeight: "500",
  },
  inviteNote: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    textAlign: "center",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    paddingBottom: "8px",
  },
  footerLink: {
    color: "var(--text-tertiary)",
    textDecoration: "none",
  },
  footerSep: {
    color: "var(--text-tertiary)",
  },
};
