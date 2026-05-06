"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AdminDevMessage, AdminDevSessionWithMeta } from "@/lib/types";

interface PhaseEntry {
  number: string;
  name: string;
  status: "complete" | "active" | "queued";
}

interface StackEntry {
  layer: string;
  technology: string;
}

interface DevContext {
  phases: PhaseEntry[];
  stack: StackEntry[];
}

function PhaseIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    complete: "#10b981",
    active: "#f59e0b",
    queued: "var(--text-tertiary)",
  };
  const labels: Record<string, string> = {
    complete: "✓ Complete",
    active: "⟳ In progress",
    queued: "○ Queued",
  };
  return (
    <span style={{ fontSize: "0.75rem", color: colors[status] ?? "var(--text-tertiary)", fontWeight: 500 }}>
      {labels[status] ?? status}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export default function DevPage() {
  const [sessions, setSessions] = useState<AdminDevSessionWithMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdminDevMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [devContext, setDevContext] = useState<DevContext | null>(null);
  const [contextError, setContextError] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const newSessionInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Load sessions list
  useEffect(() => {
    fetch("/api/admin/dev/sessions")
      .then((r) => r.json())
      .then((rows: AdminDevSessionWithMeta[]) => {
        setSessions(rows);
        if (rows.length > 0) setActiveSessionId(rows[0].id);
      })
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSessionId) return;
    setLoadingMessages(true);
    setMessages([]);
    fetch(`/api/admin/dev/messages?sessionId=${activeSessionId}`)
      .then((r) => r.json())
      .then((rows: AdminDevMessage[]) => setMessages(rows))
      .catch(() => {})
      .finally(() => setLoadingMessages(false));
  }, [activeSessionId]);

  // Load context panel
  useEffect(() => {
    if (!contextOpen || devContext || contextError) return;
    setContextLoading(true);
    fetch("/api/admin/dev/context")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data: DevContext) => setDevContext(data))
      .catch(() => setContextError(true))
      .finally(() => setContextLoading(false));
  }, [contextOpen, devContext, contextError]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus new session input when modal opens
  useEffect(() => {
    if (newSessionModalOpen) {
      setTimeout(() => newSessionInputRef.current?.focus(), 50);
    }
  }, [newSessionModalOpen]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle) {
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 50);
    }
  }, [editingTitle]);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setDrawerOpen(false);
  }, []);

  async function createSession() {
    const name = newSessionName.trim();
    setNewSessionModalOpen(false);
    setNewSessionName("");
    const r = await fetch("/api/admin/dev/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || undefined }),
    });
    if (!r.ok) return;
    const newSession: AdminDevSessionWithMeta = {
      ...(await r.json()),
      message_count: 0,
      last_message_preview: null,
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setMessages([]);
  }

  async function renameSession(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const r = await fetch(`/api/admin/dev/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!r.ok) return;
    const updated = await r.json();
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: updated.name } : s))
    );
    setEditingTitle(false);
  }

  async function deleteSession(id: string) {
    if (!confirm("Delete this session and all its messages? This cannot be undone.")) return;
    const r = await fetch(`/api/admin/dev/sessions/${id}`, { method: "DELETE" });
    if (!r.ok) return;
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (activeSessionId === id) {
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
      } else {
        // Auto-create a new session if none remain
        const r2 = await fetch("/api/admin/dev/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (r2.ok) {
          const ns: AdminDevSessionWithMeta = { ...(await r2.json()), message_count: 0, last_message_preview: null };
          setSessions([ns]);
          setActiveSessionId(ns.id);
        } else {
          setActiveSessionId(null);
        }
        setMessages([]);
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || !activeSessionId) return;

    const userMsg: AdminDevMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      session_id: activeSessionId,
      created_at: new Date().toISOString(),
    };
    const assistantMsg: AdminDevMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
      session_id: activeSessionId,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSending(true);

    try {
      const r = await fetch("/api/admin/dev/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId: activeSessionId }),
      });

      if (!r.ok || !r.body) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: "Request failed." } : m))
        );
        setSending(false);
        return;
      }

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const snap = accumulated;
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: snap } : m))
        );
      }

      // Update session preview in list
      setSessions((prev) =>
        prev
          .map((s) =>
            s.id === activeSessionId
              ? {
                  ...s,
                  message_count: s.message_count + 2,
                  last_message_preview: accumulated.slice(0, 100),
                  updated_at: new Date().toISOString(),
                }
              : s
          )
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id ? { ...m, content: "Stream error." } : m
        )
      );
    }

    setSending(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  function startTitleEdit() {
    setTitleDraft(activeSession?.name ?? "");
    setEditingTitle(true);
  }

  function commitTitleEdit() {
    if (activeSessionId && titleDraft.trim()) {
      renameSession(activeSessionId, titleDraft);
    } else {
      setEditingTitle(false);
    }
  }

  return (
    <>
      {/* New session modal */}
      {newSessionModalOpen && (
        <div
          className="admin-dev-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) { setNewSessionModalOpen(false); setNewSessionName(""); } }}
        >
          <div className="admin-dev-modal">
            <div className="admin-dev-modal-title">New session</div>
            <input
              ref={newSessionInputRef}
              className="admin-dev-modal-input"
              placeholder={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createSession();
                if (e.key === "Escape") { setNewSessionModalOpen(false); setNewSessionName(""); }
              }}
            />
            <div className="admin-dev-modal-actions">
              <button
                className="admin-btn-secondary"
                style={{ fontSize: "0.8125rem", padding: "5px 12px" }}
                onClick={() => { setNewSessionModalOpen(false); setNewSessionName(""); }}
              >
                Cancel
              </button>
              <button
                className="admin-btn-primary"
                style={{ fontSize: "0.8125rem", padding: "5px 14px" }}
                onClick={createSession}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 89 }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className="admin-dev-layout">
        {/* Left: Sessions panel */}
        <div className={`admin-dev-sessions-panel${drawerOpen ? " admin-dev-sessions-panel--drawer-open" : ""}`}>
          <div className="admin-dev-sessions-header">
            <button
              className="admin-btn-primary"
              style={{ width: "100%", fontSize: "0.8125rem", padding: "6px 12px" }}
              onClick={() => { setNewSessionModalOpen(true); setDrawerOpen(false); }}
            >
              + New session
            </button>
          </div>

          <div className="admin-dev-sessions-list">
            {loadingSessions ? (
              <div style={{ padding: "16px 12px", color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>
                Loading…
              </div>
            ) : sessions.length === 0 ? (
              <div style={{ padding: "16px 12px", color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>
                No sessions yet.
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`admin-dev-session-item${activeSessionId === s.id ? " admin-dev-session-item--active" : ""}`}
                  onClick={() => switchSession(s.id)}
                >
                  <div className="admin-dev-session-info">
                    <div className="admin-dev-session-name">{s.name}</div>
                    <div className="admin-dev-session-meta">
                      {formatDate(s.updated_at)} · {s.message_count} msg{s.message_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="admin-dev-session-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="admin-dev-session-action-btn"
                      title="Rename"
                      onClick={() => {
                        setActiveSessionId(s.id);
                        setTimeout(() => startTitleEdit(), 50);
                        setDrawerOpen(false);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      className="admin-dev-session-action-btn admin-dev-session-action-btn--danger"
                      title="Delete"
                      onClick={() => deleteSession(s.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Chat panel */}
        <div className="admin-dev-chat-panel">
          {/* Header */}
          <div className="admin-dev-header">
            <div className="admin-dev-session-title-area">
              {/* Mobile: sessions drawer button */}
              <button
                className="admin-btn-secondary"
                style={{ fontSize: "0.8125rem", padding: "4px 10px", flexShrink: 0 }}
                onClick={() => setDrawerOpen(true)}
                aria-label="Sessions"
                title="Sessions"
              >
                ☰
              </button>

              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  className="admin-dev-session-title-input"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={commitTitleEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitleEdit();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                />
              ) : (
                <span
                  className="admin-dev-session-title"
                  title="Click to rename"
                  onClick={startTitleEdit}
                >
                  {activeSession?.name ?? "No session"}
                </span>
              )}
            </div>

            <div className="admin-dev-header-actions">
              <button
                className="admin-btn-secondary"
                style={{ fontSize: "0.8125rem", padding: "5px 12px" }}
                onClick={() => setContextOpen(!contextOpen)}
              >
                {contextOpen ? "Hide context" : "Show context"}
              </button>
              <button
                className="admin-btn-secondary"
                style={{ fontSize: "0.8125rem", padding: "5px 12px", color: "#dc2626" }}
                onClick={() => activeSessionId && deleteSession(activeSessionId)}
                disabled={!activeSessionId}
                title="Delete this session"
              >
                Delete session
              </button>
            </div>
          </div>

          {/* Context panel */}
          {contextOpen && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontFamily: "monospace", fontSize: "0.8125rem", maxHeight: "240px", overflowY: "auto" }}>
              {contextLoading ? (
                <div style={{ color: "var(--text-tertiary)" }}>Loading…</div>
              ) : contextError ? (
                <div style={{ color: "var(--text-tertiary)" }}>Could not load context from CLAUDE.md</div>
              ) : devContext ? (
                <>
                  <h3 style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                    Stack
                  </h3>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {devContext.stack.map(({ layer, technology }) => (
                        <tr key={layer}>
                          <td style={{ padding: "3px 12px 3px 0", color: "var(--text-tertiary)", whiteSpace: "nowrap", verticalAlign: "top" }}>{layer}</td>
                          <td style={{ padding: "3px 0", color: "var(--text-primary)" }}>{technology}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <h3 style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 10px" }}>
                    Build Phases
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {devContext.phases.map((p) => (
                      <div key={p.number} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--text-primary)" }}>Phase {p.number} — {p.name}</span>
                        <PhaseIndicator status={p.status} />
                      </div>
                    ))}
                  </div>
                  <p style={{ marginTop: "12px", color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
                    Full CLAUDE.md is loaded in the system prompt.
                  </p>
                </>
              ) : null}
            </div>
          )}

          {/* Messages */}
          <div className="admin-dev-messages">
            {!activeSessionId ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
                Create or select a session to start.
              </div>
            ) : loadingMessages ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
                Loading messages…
              </div>
            ) : messages.length === 0 ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
                Paste logs, errors, configs, or ask anything about the stack. Bruce has full technical context loaded.
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}
                >
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      color: m.role === "user" ? "var(--accent)" : "var(--text-secondary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginBottom: "6px",
                    }}
                  >
                    {m.role === "user" ? "Jake" : "Bruce"}
                  </div>
                  <div
                    style={{
                      fontSize: "0.9375rem",
                      color: "var(--text-primary)",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.6,
                    }}
                  >
                    {m.content || (m.role === "assistant" && sending ? (
                      <span style={{ color: "var(--text-tertiary)" }}>…</span>
                    ) : "")}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="admin-dev-input-area">
            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 12px", background: "var(--bg-primary)" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything technical, or paste logs / errors / configs here…"
                className="admin-dev-input"
                rows={4}
                disabled={sending || !activeSessionId}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
                  ⌘ + Enter to send
                </span>
                <button
                  className="admin-btn-primary"
                  onClick={send}
                  disabled={sending || !input.trim() || !activeSessionId}
                  style={{ padding: "7px 16px" }}
                >
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
