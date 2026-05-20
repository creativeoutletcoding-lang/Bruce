"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AdminDevMessage, AdminDevSessionWithMeta } from "@/lib/types";

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [inlineNewSession, setInlineNewSession] = useState(false);
  const [inlineNewName, setInlineNewName] = useState("");
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const inlineNewRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Load sessions — auto-create one if none exist
  useEffect(() => {
    async function initSessions() {
      try {
        const r = await fetch("/api/admin/dev/sessions");
        if (!r.ok) throw new Error("sessions fetch failed");
        const rows: AdminDevSessionWithMeta[] = await r.json();
        if (rows.length > 0) {
          setSessions(rows);
          setActiveSessionId(rows[0].id);
        } else {
          const r2 = await fetch("/api/admin/dev/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (r2.ok) {
            const newSession: AdminDevSessionWithMeta = {
              ...(await r2.json()),
              message_count: 0,
              last_message_preview: null,
            };
            setSessions([newSession]);
            setActiveSessionId(newSession.id);
          }
        }
      } catch {
        // Sessions unavailable — leave activeSessionId null
      } finally {
        setLoadingSessions(false);
      }
    }
    initSessions();
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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus inline new session input
  useEffect(() => {
    if (inlineNewSession) setTimeout(() => inlineNewRef.current?.focus(), 30);
  }, [inlineNewSession]);

  // Focus rename input in sessions list
  useEffect(() => {
    if (renamingSessionId) setTimeout(() => renameInputRef.current?.focus(), 30);
  }, [renamingSessionId]);

  // Focus title input when editing inline in the header
  useEffect(() => {
    if (editingTitle) {
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 50);
    }
  }, [editingTitle]);

  // Close ··· menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setDrawerOpen(false);
    setRenamingSessionId(null);
  }, []);

  async function createSessionInline() {
    const name = inlineNewName.trim();
    setInlineNewSession(false);
    setInlineNewName("");
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
    setRenamingSessionId(null);
    setEditingTitle(false);
    if (!trimmed) return;
    const r = await fetch(`/api/admin/dev/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });
    if (!r.ok) return;
    const updated = await r.json();
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name: updated.name } : s)));
  }

  async function deleteSession(id: string) {
    setMenuOpen(false);
    if (!confirm("Delete this session and all its messages? This cannot be undone.")) return;
    const r = await fetch(`/api/admin/dev/sessions/${id}`, { method: "DELETE" });
    if (!r.ok) return;
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (activeSessionId === id) {
      if (remaining.length > 0) {
        setActiveSessionId(remaining[0].id);
      } else {
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

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

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

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    const lineH = parseInt(getComputedStyle(el).lineHeight) || 22;
    el.style.height = Math.min(el.scrollHeight, lineH * 6 + 16) + "px";
  }

  function startTitleEdit() {
    setTitleDraft(activeSession?.name ?? "");
    setEditingTitle(true);
    setMenuOpen(false);
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
      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 89 }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className="admin-dev-layout">
        {/* ── Left: Sessions panel ── */}
        <div className={`admin-dev-sessions-panel${drawerOpen ? " admin-dev-sessions-panel--drawer-open" : ""}`}>
          <div className="admin-dev-sessions-header">
            <button
              className="admin-dev-new-session-btn"
              onClick={() => { setInlineNewSession(true); setDrawerOpen(false); }}
            >
              + New session
            </button>
          </div>

          <div className="admin-dev-sessions-list">
            {inlineNewSession && (
              <div className="admin-dev-session-item admin-dev-session-item--new">
                <input
                  ref={inlineNewRef}
                  className="admin-dev-inline-name-input"
                  placeholder={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                  value={inlineNewName}
                  onChange={(e) => setInlineNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createSessionInline();
                    if (e.key === "Escape") { setInlineNewSession(false); setInlineNewName(""); }
                  }}
                  onBlur={createSessionInline}
                />
              </div>
            )}

            {loadingSessions ? (
              <div style={{ padding: "12px", color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>
                Loading…
              </div>
            ) : sessions.length === 0 && !inlineNewSession ? (
              <div style={{ padding: "12px", color: "var(--text-tertiary)", fontSize: "0.8125rem" }}>
                No sessions yet.
              </div>
            ) : (
              sessions.map((s) => {
                const isActive = activeSessionId === s.id;
                const isRenaming = renamingSessionId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`admin-dev-session-item${isActive ? " admin-dev-session-item--active" : ""}`}
                    onClick={() => !isRenaming && switchSession(s.id)}
                  >
                    <div className="admin-dev-session-info">
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          className="admin-dev-inline-name-input"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameSession(s.id, renameDraft);
                            if (e.key === "Escape") setRenamingSessionId(null);
                          }}
                          onBlur={() => renameSession(s.id, renameDraft)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <div className="admin-dev-session-name">{s.name}</div>
                      )}
                      <div className="admin-dev-session-meta">
                        {formatDate(s.updated_at)} · {s.message_count} msg{s.message_count !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div className="admin-dev-session-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="admin-dev-session-action-btn"
                        title="Rename"
                        onClick={() => {
                          if (!isActive) switchSession(s.id);
                          setRenamingSessionId(s.id);
                          setRenameDraft(s.name);
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
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: Chat panel ── */}
        <div className="admin-dev-chat-panel">
          {/* Minimal title bar */}
          <div className="admin-dev-chat-title-bar">
            <button
              className="admin-dev-drawer-btn"
              onClick={() => setDrawerOpen(true)}
              aria-label="Sessions"
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

            {/* ··· menu */}
            <div ref={menuRef} style={{ position: "relative" }}>
              <button
                className={`admin-dev-menu-btn${menuOpen ? " admin-dev-menu-btn--open" : ""}`}
                onClick={() => setMenuOpen(!menuOpen)}
                title="Session options"
              >
                ···
              </button>
              {menuOpen && (
                <div className="admin-dev-menu-dropdown">
                  <button className="admin-dev-menu-item" onClick={startTitleEdit}>
                    Rename
                  </button>
                  <button
                    className="admin-dev-menu-item admin-dev-menu-item--danger"
                    onClick={() => activeSessionId && deleteSession(activeSessionId)}
                    disabled={!activeSessionId}
                  >
                    Delete session
                  </button>
                </div>
              )}
            </div>
          </div>

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
                  className={`admin-dev-message${m.role === "user" ? " admin-dev-message--user" : " admin-dev-message--bruce"}`}
                >
                  <div className="admin-dev-message-label">
                    {m.role === "user" ? "Jake" : "Bruce"}
                  </div>
                  <div className="admin-dev-message-content">
                    {m.content || (m.role === "assistant" && sending ? (
                      <span style={{ color: "var(--text-tertiary)" }}>…</span>
                    ) : "")}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input docked to bottom */}
          <div className="admin-dev-input-area">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything technical, or paste logs / errors / configs here…"
              className="admin-dev-input"
              rows={2}
              disabled={sending || !activeSessionId}
            />
            <div className="admin-dev-input-footer">
              <span className="admin-dev-input-hint">⌘ + Enter to send</span>
              <button
                className="admin-btn-primary"
                onClick={send}
                disabled={sending || !input.trim() || !activeSessionId}
                style={{ padding: "6px 14px", fontSize: "0.8125rem" }}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
