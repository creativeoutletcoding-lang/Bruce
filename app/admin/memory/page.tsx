"use client";

import { useEffect, useState } from "react";

interface MemberSummary {
  user_id: string;
  name: string;
  color_hex: string;
  core_count: number;
  active_count: number;
  archive_count: number;
  total_count: number;
  categories: string[];
}

interface MemoryEntry {
  id: string;
  content: string;
  tier: string;
  relevance_score: number;
  category: string | null;
  last_accessed: string;
  created_at: string;
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    core: "var(--accent)",
    active: "#3b82f6",
    archive: "var(--text-tertiary)",
  };
  return (
    <span
      style={{
        padding: "1px 7px",
        borderRadius: "var(--radius-full)",
        fontSize: "0.7rem",
        fontWeight: 600,
        backgroundColor: `${colors[tier] ?? "var(--text-tertiary)"}20`,
        color: colors[tier] ?? "var(--text-tertiary)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {tier}
    </span>
  );
}

function MemoryModal({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [compressing, setCompressing] = useState(false);
  const [compressResult, setCompressResult] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  async function load() {
    const r = await fetch(`/api/admin/memory?user_id=${userId}`);
    const d = await r.json();
    setEntries(d as MemoryEntry[]);
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [userId]);

  async function deleteEntry(id: string) {
    const ok = window.confirm("Delete this memory entry?");
    if (!ok) return;
    await fetch(`/api/admin/memory/${id}`, { method: "DELETE" });
    await load();
  }

  async function updateTier(id: string, tier: string) {
    await fetch(`/api/admin/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    await load();
  }

  async function saveEdit(id: string) {
    await fetch(`/api/admin/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    setEditingId(null);
    await load();
  }

  async function compress() {
    setCompressing(true);
    setCompressResult(null);
    const r = await fetch("/api/admin/memory/compress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const d = await r.json() as { archived?: number; message?: string };
    setCompressResult(
      d.archived !== undefined ? `Archived ${d.archived} ${d.archived === 1 ? "entry" : "entries"}` : (d.message ?? "Done")
    );
    setCompressing(false);
    await load();
  }

  const tiers = ["core", "active", "archive"];

  return (
    <div
      className="admin-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="admin-modal" style={{ width: "min(700px, 95vw)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexShrink: 0 }}>
          <h2 style={{ fontSize: "1.0625rem", fontWeight: 600 }}>{userName} — Memory</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              className="admin-btn-secondary"
              onClick={compress}
              disabled={compressing}
              style={{ fontSize: "0.8125rem", padding: "5px 12px" }}
            >
              {compressing ? "Compressing…" : "Compress"}
            </button>
            <button onClick={onClose} className="admin-modal-close">✕</button>
          </div>
        </div>

        {compressResult && (
          <p style={{ fontSize: "0.875rem", color: "var(--accent)", marginBottom: "12px", flexShrink: 0 }}>
            {compressResult}
          </p>
        )}

        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <p className="admin-section-loading">Loading memories…</p>
          ) : entries.length === 0 ? (
            <p className="admin-empty">No memories stored.</p>
          ) : (
            tiers.map((tier) => {
              const group = entries.filter((e) => e.tier === tier);
              if (group.length === 0) return null;
              return (
                <div key={tier} style={{ marginBottom: "20px" }}>
                  <h3
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: "var(--text-tertiary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: "8px",
                    }}
                  >
                    {tier} ({group.length})
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {group.map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          padding: "10px 12px",
                          backgroundColor: "var(--bg-secondary)",
                          borderRadius: "var(--radius-md)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {editingId === entry.id ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="admin-input"
                              rows={3}
                              style={{ resize: "vertical" }}
                            />
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                className="admin-btn-primary"
                                style={{ fontSize: "0.8125rem", padding: "4px 10px" }}
                                onClick={() => saveEdit(entry.id)}
                              >
                                Save
                              </button>
                              <button
                                className="admin-btn-secondary"
                                style={{ fontSize: "0.8125rem", padding: "4px 10px" }}
                                onClick={() => setEditingId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                            <p style={{ flex: 1, fontSize: "0.875rem", color: "var(--text-primary)", lineHeight: 1.5 }}>
                              {entry.content}
                            </p>
                            <div style={{ display: "flex", gap: "6px", flexShrink: 0, alignItems: "center" }}>
                              <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                                {entry.category ?? "—"}
                              </span>
                              <select
                                value={entry.tier}
                                onChange={(e) => updateTier(entry.id, e.target.value)}
                                className="admin-select"
                                style={{ fontSize: "0.75rem", padding: "2px 6px" }}
                              >
                                <option value="core">core</option>
                                <option value="active">active</option>
                                <option value="archive">archive</option>
                              </select>
                              <button
                                onClick={() => {
                                  setEditingId(entry.id);
                                  setEditContent(entry.content);
                                }}
                                className="admin-btn-secondary"
                                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteEntry(entry.id)}
                                className="admin-btn-danger"
                                style={{ fontSize: "0.75rem", padding: "2px 8px" }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function MemoryPage() {
  const [members, setMembers] = useState<MemberSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMember, setActiveMember] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/memory")
      .then((r) => r.json())
      .then((d) => {
        setMembers(d as MemberSummary[]);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load memory data");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="admin-section-loading">Loading memory overview…</div>;
  if (error) return <div className="admin-error">{error}</div>;

  return (
    <div className="admin-section">
      <h1 className="admin-section-title">Memory</h1>
      <p className="admin-section-note">
        High-level overview. Use Manage to view, edit, or delete entries for any member.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {members.map((m) => (
          <div key={m.user_id} className="admin-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", backgroundColor: m.color_hex, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: "0.75rem" }}>
                  {m.name[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>{m.name}</div>
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-tertiary)" }}>
                    {m.total_count} {m.total_count === 1 ? "entry" : "entries"} total
                  </div>
                </div>
              </div>
              <button
                className="admin-btn-secondary"
                style={{ fontSize: "0.875rem", padding: "6px 14px" }}
                onClick={() => setActiveMember({ id: m.user_id, name: m.name })}
              >
                Manage
              </button>
            </div>

            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
              {(["core", "active", "archive"] as const).map((tier) => (
                <div key={tier} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <TierBadge tier={tier} />
                  <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    {m[`${tier}_count`]}
                  </span>
                </div>
              ))}
            </div>

            {m.categories.length > 0 && (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {m.categories.map((cat) => (
                  <span
                    key={cat}
                    style={{
                      padding: "2px 8px",
                      borderRadius: "var(--radius-full)",
                      fontSize: "0.75rem",
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {activeMember && (
        <MemoryModal
          userId={activeMember.id}
          userName={activeMember.name}
          onClose={() => setActiveMember(null)}
        />
      )}
    </div>
  );
}
