"use client";

import { useEffect, useState } from "react";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  avatar_url: string | null;
  color_hex: string;
  created_at: string;
  deactivated_at: string | null;
  purge_at: string | null;
  last_active: string | null;
  message_count: number;
}

function Avatar({ name, colorHex }: { name: string; colorHex: string }) {
  console.log('avatar rendering, color_hex:', colorHex);
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        backgroundColor: colorHex,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.8125rem",
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {name[0].toUpperCase()}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = status === "active" ? "#10b981" : status === "deactivated" ? "#ef4444" : "#f59e0b";
  return (
    <span style={{ fontSize: "0.8125rem", color, fontWeight: 500 }}>
      {status}
    </span>
  );
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/admin/members");
    const d = await r.json();
    if (r.ok) setMembers(d as Member[]);
    else setError("Failed to load members");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateRole(id: string, role: string) {
    setActionLoading(id + ":role");
    await fetch(`/api/admin/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await load();
    setActionLoading(null);
  }

  async function toggleActivation(member: Member) {
    const action = member.status === "active" ? "deactivate" : "reactivate";
    if (action === "deactivate") {
      const ok = window.confirm(
        `Deactivate ${member.name}? They will lose access immediately. Their data is held for 30 days before purge.`
      );
      if (!ok) return;
    }
    setActionLoading(member.id + ":status");
    await fetch(`/api/admin/members/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await load();
    setActionLoading(null);
  }

  async function generateInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteLoading(true);
    setInviteUrl(null);
    const r = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim() || undefined, role: "member" }),
    });
    setInviteLoading(false);
    if (r.ok) {
      const d = await r.json() as { invite_url: string };
      setInviteUrl(d.invite_url);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  }

  if (loading) return <div className="admin-section-loading">Loading members…</div>;
  if (error) return <div className="admin-error">{error}</div>;

  return (
    <div className="admin-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
        <h1 className="admin-section-title">Members</h1>
        <button className="admin-btn-primary" onClick={() => { setInviteOpen(true); setInviteUrl(null); setInviteEmail(""); }}>
          Generate Invite
        </button>
      </div>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Active</th>
                <th style={{ textAlign: "right" }}>Messages</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Avatar name={m.name} colorHex={m.color_hex} />
                      <span style={{ fontWeight: 500 }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>{m.email}</td>
                  <td>
                    <select
                      value={m.role}
                      disabled={actionLoading === m.id + ":role"}
                      onChange={(e) => updateRole(m.id, e.target.value)}
                      className="admin-select"
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                    {m.purge_at && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginTop: 2 }}>
                        Purge: {formatDate(m.purge_at)}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                    {formatDate(m.last_active)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                    {m.message_count.toLocaleString()}
                  </td>
                  <td>
                    <button
                      className={m.status === "active" ? "admin-btn-danger" : "admin-btn-secondary"}
                      disabled={actionLoading === m.id + ":status"}
                      onClick={() => toggleActivation(m)}
                      style={{ fontSize: "0.8125rem", padding: "4px 10px" }}
                    >
                      {actionLoading === m.id + ":status"
                        ? "…"
                        : m.status === "active"
                        ? "Deactivate"
                        : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {inviteOpen && (
        <div className="admin-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setInviteOpen(false); }}>
          <div className="admin-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ fontSize: "1.0625rem", fontWeight: 600 }}>Generate Invite Link</h2>
              <button onClick={() => setInviteOpen(false)} className="admin-modal-close">✕</button>
            </div>

            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Single-use, expires in 48 hours.
            </p>

            <form onSubmit={generateInvite} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label className="admin-label">Email (optional pre-fill)</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                  className="admin-input"
                />
              </div>
              <button type="submit" disabled={inviteLoading} className="admin-btn-primary">
                {inviteLoading ? "Generating…" : "Generate link"}
              </button>
            </form>

            {inviteUrl && (
              <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "var(--bg-secondary)", borderRadius: "var(--radius-md)", border: "1px solid var(--border)" }}>
                <p style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Invite URL
                </p>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <code style={{ flex: 1, fontSize: "0.8125rem", color: "var(--text-primary)", wordBreak: "break-all" }}>
                    {inviteUrl}
                  </code>
                  <button onClick={copyInvite} className="admin-btn-secondary" style={{ flexShrink: 0, padding: "4px 10px", fontSize: "0.8125rem" }}>
                    {inviteCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
