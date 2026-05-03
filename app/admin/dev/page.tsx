"use client";

import { useEffect, useRef, useState } from "react";

interface DevMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const PHASE_STATUS = [
  { phase: "1 — Foundation", status: "complete" },
  { phase: "2 — Core Chat", status: "complete" },
  { phase: "3 — Projects", status: "complete" },
  { phase: "4 — Household", status: "complete" },
  { phase: "5 — Connectors + Admin", status: "in-progress" },
  { phase: "6 — Polish", status: "not-started" },
];

const STACK = [
  ["Frontend", "Next.js 15, React 19, TypeScript"],
  ["Hosting", "Vercel — auto-deploy from GitHub main"],
  ["Database", "Supabase (Postgres + RLS + Realtime)"],
  ["Auth", "Supabase Auth + Google OAuth"],
  ["Background jobs", "DigitalOcean droplet + PM2"],
  ["Push notifications", "Firebase Cloud Messaging"],
  ["AI model", "claude-sonnet-4-6"],
  ["Image gen", "Replicate"],
  ["Web search", "Perplexity API"],
];

function PhaseIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    complete: "#10b981",
    "in-progress": "#f59e0b",
    "not-started": "var(--text-tertiary)",
  };
  const labels: Record<string, string> = {
    complete: "✓ Complete",
    "in-progress": "⟳ In progress",
    "not-started": "○ Not started",
  };
  return (
    <span style={{ fontSize: "0.75rem", color: colors[status], fontWeight: 500 }}>
      {labels[status]}
    </span>
  );
}

export default function DevPage() {
  const [messages, setMessages] = useState<DevMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: DevMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantMsg: DevMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSending(true);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      const r = await fetch("/api/admin/dev/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      if (!r.ok || !r.body) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: "Request failed." } : m
          )
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

  return (
    <div className="admin-section admin-dev-layout">
      <div className="admin-dev-header">
        <h1 className="admin-section-title" style={{ margin: 0 }}>Bruce Dev</h1>
        <button
          className="admin-btn-secondary"
          style={{ fontSize: "0.8125rem", padding: "5px 12px" }}
          onClick={() => setContextOpen(!contextOpen)}
        >
          {contextOpen ? "Hide context" : "Show context"}
        </button>
      </div>

      {contextOpen && (
        <div className="admin-card" style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
          <h3 style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
            Stack
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {STACK.map(([layer, tech]) => (
                <tr key={layer}>
                  <td style={{ padding: "3px 12px 3px 0", color: "var(--text-tertiary)", whiteSpace: "nowrap", verticalAlign: "top" }}>{layer}</td>
                  <td style={{ padding: "3px 0", color: "var(--text-primary)" }}>{tech}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "16px 0 10px" }}>
            Build Phases
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {PHASE_STATUS.map((p) => (
              <div key={p.phase} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-primary)" }}>Phase {p.phase}</span>
                <PhaseIndicator status={p.status} />
              </div>
            ))}
          </div>

          <p style={{ marginTop: "12px", color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
            Full CLAUDE.md is loaded in the system prompt — Bruce has complete technical context.
          </p>
        </div>
      )}

      <div className="admin-dev-messages admin-card" style={{ flex: 1, overflowY: "auto", minHeight: "300px", maxHeight: "calc(100vh - 420px)", gap: "0" }}>
        {messages.length === 0 ? (
          <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: "0.875rem" }}>
            Paste logs, errors, configs, or ask anything about the stack. Bruce has full technical context loaded.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border)",
              }}
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
                  fontFamily: m.role === "user" ? "inherit" : "inherit",
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

      <div className="admin-card" style={{ padding: "12px" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything technical, or paste logs / errors / configs here…"
          className="admin-dev-input"
          rows={4}
          disabled={sending}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
          <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
            ⌘ + Enter to send
          </span>
          <button
            className="admin-btn-primary"
            onClick={send}
            disabled={sending || !input.trim()}
            style={{ padding: "7px 16px" }}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
