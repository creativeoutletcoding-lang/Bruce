"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useChatContext } from "@/components/layout/ChatShell";
import type { User } from "@/lib/types";

interface ChatListItem {
  id: string;
  title: string | null;
  type: string;
  last_message_at: string;
  last_message_content?: string;
  last_message_role?: string;
}

interface SidebarProps {
  user: User;
  onNavigate: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Sidebar({ user, onNavigate }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { registerRefresh } = useChatContext();
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const supabase = createClient();

  const activeChatId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;

  const loadChats = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("chats")
      .select(`id, title, type, last_message_at, messages (content, role, created_at)`)
      .is("project_id", null)
      .neq("type", "incognito")
      .order("last_message_at", { ascending: false });

    if (!data) return;

    const enriched: ChatListItem[] = data.map((chat) => {
      const msgs = (chat.messages as Array<{ content: string; role: string; created_at: string }>) ?? [];
      const sorted = [...msgs].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const last = sorted[0];
      return {
        id: chat.id as string,
        title: chat.title as string | null,
        type: chat.type as string,
        last_message_at: chat.last_message_at as string,
        last_message_content: last?.content,
        last_message_role: last?.role,
      };
    });

    setChats(enriched);
  }, []);

  useEffect(() => {
    registerRefresh(loadChats);
    loadChats();

    const existing = supabase.getChannels().find(c => c.topic === "realtime:chat-list");
    if (existing) supabase.removeChannel(existing);

    const channel = supabase
      .channel("chat-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chats" },
        () => loadChats()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => loadChats()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function handleNewChat() {
    router.push("/chat");
    onNavigate();
  }

  function handleSelectChat(chatId: string) {
    router.push(`/chat/${chatId}`);
    onNavigate();
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div style={styles.sidebar}>
      {/* New chat button */}
      <div style={styles.header}>
        <button
          onClick={handleNewChat}
          style={styles.newChatButton}
          aria-label="New chat"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          New chat
        </button>
      </div>

      {/* Chat list */}
      <div style={styles.chatList}>
        <div style={styles.sectionLabel}>Chats</div>
        {chats.length === 0 ? (
          <p style={styles.emptyState}>No conversations yet</p>
        ) : (
          chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const preview = chat.last_message_content
              ? chat.last_message_content.substring(0, 60)
              : null;

            return (
              <button
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                style={{
                  ...styles.chatItem,
                  ...(isActive ? styles.chatItemActive : {}),
                }}
              >
                <span style={styles.chatItemTitle}>
                  {chat.title ?? "Untitled"}
                </span>
                <div style={styles.chatItemMeta}>
                  {preview && (
                    <span style={styles.chatItemPreview}>{preview}</span>
                  )}
                  <span style={styles.chatItemTime}>
                    {formatRelativeTime(chat.last_message_at)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Family section — placeholder */}
      <div style={styles.familySection}>
        <div style={styles.sectionLabel}>Family</div>
        <p style={styles.familyPlaceholder}>Coming soon</p>
      </div>

      {/* User profile */}
      <div style={styles.userSection}>
        <div style={styles.userInfo}>
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt=""
              style={styles.avatar}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div style={styles.avatarFallback}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <span style={styles.userName}>{user.name.split(" ")[0]}</span>
        </div>
        <div style={styles.userActions}>
          <button
            onClick={() => { router.push("/settings"); onNavigate(); }}
            style={styles.iconButton}
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button onClick={handleSignOut} style={styles.iconButton} title="Sign out">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l3-3-3-3M13 8H6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    padding: "12px",
    borderBottom: "1px solid var(--border)",
  },
  newChatButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "9px 12px",
    backgroundColor: "var(--accent)",
    color: "#fff",
    borderRadius: "var(--radius-md)",
    fontSize: "0.875rem",
    fontWeight: "500",
    cursor: "pointer",
    transition: "opacity var(--transition)",
  },
  chatList: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 6px",
  },
  sectionLabel: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    padding: "4px 8px 6px",
  },
  emptyState: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    padding: "8px",
    textAlign: "center",
  },
  chatItem: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color var(--transition)",
    backgroundColor: "transparent",
    color: "var(--text-primary)",
    borderLeft: "2px solid transparent",
  },
  chatItemActive: {
    backgroundColor: "rgba(15, 110, 86, 0.08)",
    borderLeft: "2px solid var(--accent)",
    color: "var(--accent)",
  },
  chatItemTitle: {
    fontSize: "0.875rem",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatItemMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  chatItemPreview: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  chatItemTime: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  familySection: {
    padding: "8px 6px",
    borderTop: "1px solid var(--border)",
  },
  familyPlaceholder: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    padding: "4px 8px",
  },
  userSection: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px",
    borderTop: "1px solid var(--border)",
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  avatar: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    objectFit: "cover",
  },
  avatarFallback: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--accent)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: "600",
  },
  userName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
  userActions: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
  },
  iconButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    transition: "color var(--transition), background-color var(--transition)",
  },
};
