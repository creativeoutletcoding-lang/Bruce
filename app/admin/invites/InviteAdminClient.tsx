"use client";

import { useState } from "react";

export default function InviteAdminClient() {
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInviteUrl(null);
    setCopied(false);

    const res = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() || undefined, role: "member" }),
    });

    setLoading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError((body as { error?: string }).error ?? "Failed to generate invite");
      return;
    }

    const data = await res.json() as { invite_url: string };
    setInviteUrl(data.invite_url);
  }

  async function handleCopy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <h1 style={styles.heading}>Generate Invite Link</h1>
        <p style={styles.sub}>Invite a new household member. Link expires in 48 hours.</p>

        <form onSubmit={handleGenerate} style={styles.form}>
          <label style={styles.label} htmlFor="email">
            Email (optional)
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nana@gmail.com"
            style={styles.input}
          />
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Generating…" : "Generate invite link"}
          </button>
        </form>

        {error && (
          <div style={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {inviteUrl && (
          <div style={styles.resultBox}>
            <p style={styles.resultLabel}>Invite link (48 hours)</p>
            <div style={styles.urlRow}>
              <span style={styles.url}>{inviteUrl}</span>
              <button onClick={handleCopy} style={styles.copyButton}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "var(--bg-secondary)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "48px 16px",
  },
  container: {
    width: "100%",
    maxWidth: "480px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  heading: {
    fontSize: "1.375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  },
  sub: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
    marginTop: "-12px",
  },
  form: {
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  label: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-secondary)",
  },
  input: {
    padding: "9px 12px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    fontSize: "0.9375rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-primary)",
    outline: "none",
  },
  button: {
    padding: "10px 16px",
    backgroundColor: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius-md)",
    fontSize: "0.9375rem",
    fontWeight: "500",
    cursor: "pointer",
    marginTop: "4px",
  },
  errorBanner: {
    padding: "12px 16px",
    backgroundColor: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: "var(--radius-sm)",
    color: "#dc2626",
    fontSize: "0.875rem",
  },
  resultBox: {
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  resultLabel: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  urlRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  url: {
    flex: 1,
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    wordBreak: "break-all",
    fontFamily: "monospace",
  },
  copyButton: {
    flexShrink: 0,
    padding: "6px 12px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
