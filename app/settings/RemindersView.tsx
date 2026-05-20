"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Reminder {
  id: string;
  content: string;
  remind_at: string;
  completed_at: string | null;
  chat_id: string | null;
  chats: { project_id: string | null } | null;
}

function formatRemindAt(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const reminderDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  if (reminderDay.getTime() === today.getTime()) return `Today at ${timeStr}`;
  if (reminderDay.getTime() === tomorrow.getTime()) return `Tomorrow at ${timeStr}`;
  return `${date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${timeStr}`;
}

function chatUrl(r: Reminder): string | null {
  if (!r.chat_id) return null;
  return r.chats?.project_id
    ? `/projects/${r.chats.project_id}/chat/${r.chat_id}`
    : `/chat/${r.chat_id}`;
}

export default function RemindersView() {
  const router = useRouter();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("reminders")
      .select("id, content, remind_at, completed_at, chat_id, chats(project_id)")
      .order("remind_at", { ascending: true });
    setReminders((data as Reminder[] | null) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleComplete(id: string) {
    const supabase = createClient();
    const completedAt = new Date().toISOString();
    await supabase.from("reminders").update({ completed_at: completedAt }).eq("id", id);
    setReminders((prev) => prev.map((r) => r.id === id ? { ...r, completed_at: completedAt } : r));
  }

  async function handleDelete(id: string) {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      return;
    }
    const supabase = createClient();
    await supabase.from("reminders").delete().eq("id", id);
    setReminders((prev) => prev.filter((r) => r.id !== id));
    setPendingDeleteId(null);
  }

  const now = new Date();
  const upcoming = reminders.filter((r) => r.completed_at === null && new Date(r.remind_at) >= now);
  const past = reminders.filter((r) => r.completed_at !== null || new Date(r.remind_at) < now);

  if (loading) return <p style={styles.empty}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {upcoming.length === 0 ? (
        <p style={styles.empty}>No upcoming reminders.</p>
      ) : (
        upcoming.map((r) => (
          <ReminderItem
            key={r.id}
            reminder={r}
            pendingDeleteId={pendingDeleteId}
            onComplete={handleComplete}
            onDelete={handleDelete}
            onOpenChat={(url) => router.push(url)}
          />
        ))
      )}

      {past.length > 0 && (
        <div style={{ marginTop: upcoming.length > 0 ? "12px" : "4px" }}>
          <button
            onClick={() => setCompletedExpanded((v) => !v)}
            style={styles.disclosureButton}
          >
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"
              style={{
                transform: completedExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                transition: "transform 150ms ease",
                flexShrink: 0,
              }}
            >
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Completed ({past.length})
          </button>
          {completedExpanded && (
            <div style={{ marginTop: "4px" }}>
              {past.map((r) => (
                <ReminderItem
                  key={r.id}
                  reminder={r}
                  pendingDeleteId={pendingDeleteId}
                  onComplete={handleComplete}
                  onDelete={handleDelete}
                  onOpenChat={(url) => router.push(url)}
                  dimmed
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReminderItem({
  reminder,
  pendingDeleteId,
  onComplete,
  onDelete,
  onOpenChat,
  dimmed,
}: {
  reminder: Reminder;
  pendingDeleteId: string | null;
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenChat: (url: string) => void;
  dimmed?: boolean;
}) {
  const isCompleted = reminder.completed_at !== null;
  const isPendingDelete = pendingDeleteId === reminder.id;
  const url = chatUrl(reminder);

  return (
    <div style={{ ...styles.row, opacity: dimmed ? 0.5 : 1 }}>
      <div style={styles.rowMain}>
        <span style={{ ...styles.content, textDecoration: isCompleted ? "line-through" : "none" }}>
          {reminder.content}
        </span>
        <div style={styles.meta}>
          <span style={styles.time}>{formatRemindAt(reminder.remind_at)}</span>
          {url && (
            <button
              onClick={() => onOpenChat(url)}
              style={styles.openChatBtn}
              aria-label="Open chat"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M1 9L9 1M9 1H4M9 1v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Open chat
            </button>
          )}
        </div>
      </div>
      <div style={styles.actions}>
        {!isCompleted && (
          <button
            onClick={() => onComplete(reminder.id)}
            style={styles.actionBtn}
            title="Mark complete"
            aria-label="Mark complete"
          >
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <path d="M2.5 7.5l3.5 3.5 6.5-6.5" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <button
          onClick={() => onDelete(reminder.id)}
          style={{
            ...styles.actionBtn,
            color: isPendingDelete ? "#c0392b" : "var(--text-tertiary)",
          }}
          title={isPendingDelete ? "Tap again to confirm delete" : "Delete"}
          aria-label={isPendingDelete ? "Confirm delete" : "Delete"}
        >
          {isPendingDelete ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 7.5h10M7.5 2.5l5 5-5 5" stroke="#c0392b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 4h10M5 4V2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 .5.5V4M5.5 7v3M8.5 7v3M3 4l.7 7.3A1 1 0 0 0 4.7 12h4.6a1 1 0 0 0 1-.7L11 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  empty: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    margin: 0,
    padding: "4px 0",
  },
  row: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "12px",
    padding: "11px 0",
    borderBottom: "1px solid var(--border)",
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  content: {
    fontSize: "0.9375rem",
    color: "var(--text-primary)",
    lineHeight: 1.4,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap" as const,
  },
  time: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
  },
  openChatBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "3px",
    fontSize: "0.8125rem",
    color: "var(--accent)",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    flexShrink: 0,
    paddingTop: "1px",
  },
  actionBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: "6px",
    borderRadius: "var(--radius-sm, 6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-tertiary)",
  },
  disclosureButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: "var(--text-tertiary)",
    padding: "2px 0",
  },
};
