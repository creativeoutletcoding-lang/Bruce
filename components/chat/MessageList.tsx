"use client";

import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import type { MessageRole } from "@/lib/types";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at?: string;
  isStreaming?: boolean;
}

interface MessageListProps {
  messages: ChatMessage[];
}

export default function MessageList({ messages }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const userScrolledUp = useRef(false);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    endRef.current?.scrollIntoView({ behavior });
  }

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUp.current = !atBottom;
    setShowScrollButton(!atBottom);
  }

  // Scroll to bottom on initial load
  useEffect(() => {
    scrollToBottom("instant");
  }, []);

  // Auto-scroll on new messages only if user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUp.current) {
      scrollToBottom("smooth");
    }
  }, [messages]);

  return (
    <div style={styles.wrapper}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={styles.container}
      >
        <div style={styles.inner}>
          <div style={styles.spacer} />
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              content={msg.content}
              timestamp={msg.created_at}
              isStreaming={msg.isStreaming}
            />
          ))}
          <div style={styles.bottomPad} />
          <div ref={endRef} />
        </div>
      </div>

      {showScrollButton && (
        <button
          onClick={() => {
            userScrolledUp.current = false;
            scrollToBottom("smooth");
          }}
          style={styles.scrollButton}
          aria-label="Scroll to bottom"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 3v10M4 9l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  container: {
    height: "100%",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  inner: {
    width: "100%",
    maxWidth: 780,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
  bottomPad: {
    height: "8px",
  },
  scrollButton: {
    position: "absolute",
    bottom: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-full)",
    color: "var(--text-secondary)",
    cursor: "pointer",
    boxShadow: "var(--shadow-md)",
  },
};
