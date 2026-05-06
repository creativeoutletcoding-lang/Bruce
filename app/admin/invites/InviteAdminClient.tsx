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
    <div className="admin-section">
      <h1 className="admin-section-title">Generate Invite Link</h1>
      <p className="admin-section-note">Invite a new household member. Link expires in 48 hours.</p>

      <div className="admin-card" style={{ maxWidth: 480 }}>
        <form onSubmit={handleGenerate} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <label className="admin-label" htmlFor="invite-email">
              Email (optional pre-fill)
            </label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@example.com"
              className="admin-input"
            />
          </div>
          <button type="submit" disabled={loading} className="admin-btn-primary">
            {loading ? "Generating…" : "Generate invite link"}
          </button>
        </form>

        {error && (
          <div className="admin-error" role="alert">
            {error}
          </div>
        )}

        {inviteUrl && (
          <div style={{ padding: "16px", backgroundColor: "var(--bg-secondary)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
            <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Invite link — 48 hours
            </p>
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <code style={{ flex: 1, fontSize: "0.8125rem", color: "var(--text-primary)", wordBreak: "break-all", lineHeight: 1.5 }}>
                {inviteUrl}
              </code>
              <button onClick={handleCopy} className="admin-btn-secondary" style={{ flexShrink: 0, padding: "5px 12px", fontSize: "0.8125rem" }}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
