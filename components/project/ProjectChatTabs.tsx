"use client";

import { useRef, useEffect } from "react";
import type { ChatPreview } from "@/lib/types";

interface ProjectChatTabsProps {
  chats: ChatPreview[];
  activeChatId: string;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
  isCreating?: boolean;
}

export default function ProjectChatTabs({
  chats,
  activeChatId,
  onSelect,
  onNewChat,
  isCreating,
}: ProjectChatTabsProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = stripRef.current?.querySelector(
      `[data-chat-tab="${activeChatId}"]`
    ) as HTMLElement | null;
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeChatId]);

  return (
    <div style={styles.wrapper}>
      <div ref={stripRef} className="chat-tabs-strip" style={styles.strip}>
        {chats.map((chat) => {
          const isActive = chat.id === activeChatId;
          return (
            <button
              key={chat.id}
              data-chat-tab={chat.id}
              onClick={() => onSelect(chat.id)}
              style={{ ...styles.tab, ...(isActive ? styles.tabActive : {}) }}
              title={chat.title ?? "New conversation"}
            >
              {chat.title ?? "New conversation"}
            </button>
          );
        })}
      </div>
      <button
        onClick={onNewChat}
        disabled={isCreating}
        style={styles.newButton}
        aria-label="New chat"
        title="New chat"
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
          <path
            d="M6.5 1.5v10M1.5 6.5h10"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    borderBottom: "0.5px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    height: "40px",
  },
  strip: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "0 12px",
    overflowX: "auto",
    height: "100%",
  },
  tab: {
    flexShrink: 0,
    height: "28px",
    padding: "0 12px",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.8125rem",
    fontWeight: "400",
    color: "var(--text-secondary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
    maxWidth: "160px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    backgroundColor: "transparent",
    transition: "background-color var(--transition), color var(--transition)",
    lineHeight: "28px",
  },
  tabActive: {
    backgroundColor: "rgba(15, 110, 86, 0.1)",
    color: "var(--accent)",
    fontWeight: "500",
  },
  newButton: {
    flexShrink: 0,
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    borderLeft: "0.5px solid var(--border)",
    backgroundColor: "transparent",
    transition: "color var(--transition), background-color var(--transition)",
  },
};
