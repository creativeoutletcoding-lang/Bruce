"use client";

import { useState } from "react";
import type { MessageRole } from "@/lib/types";

interface MessageBubbleProps {
  role: MessageRole;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  bubbleColorHex?: string;
  imageUrl?: string;
}

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
  bubbleColorHex,
  imageUrl,
}: MessageBubbleProps) {
  const [showTimestamp, setShowTimestamp] = useState(false);
  const isUser = role === "user";

  return (
    <div
      style={{ ...styles.wrapper, justifyContent: isUser ? "flex-end" : "flex-start" }}
      onMouseEnter={() => setShowTimestamp(true)}
      onMouseLeave={() => setShowTimestamp(false)}
    >
      <div className="msg-group" style={styles.messageGroup}>
        <div
          style={{
            ...styles.bubble,
            ...(isUser
              ? { ...styles.userBubble, backgroundColor: bubbleColorHex ?? "var(--accent)" }
              : styles.assistantBubble),
          }}
        >
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              style={{
                maxWidth: "240px",
                width: "100%",
                borderRadius: "var(--radius-md)",
                display: "block",
                marginBottom: content ? "8px" : 0,
              }}
            />
          )}
          {content && <span style={styles.content}>{content}</span>}
          {isStreaming && <span style={styles.cursor} aria-hidden="true" />}
        </div>
        {timestamp && showTimestamp && (
          <div style={{ ...styles.timestamp, textAlign: isUser ? "right" : "left" }}>
            {formatTimestamp(timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: "flex", padding: "2px 16px" },
  messageGroup: { display: "flex", flexDirection: "column", gap: "3px" },
  bubble: {
    padding: "10px 14px",
    borderRadius: "var(--radius-lg)",
    fontSize: "0.9375rem",
    lineHeight: "1.55",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  userBubble: { color: "#ffffff", borderBottomRightRadius: "4px" },
  assistantBubble: {
    backgroundColor: "transparent",
    color: "var(--text-primary)",
    borderBottomLeftRadius: "4px",
    border: "1px solid #2a2a2a",
  },
  content: { display: "inline" },
  cursor: {
    display: "inline-block",
    width: "2px",
    height: "1em",
    backgroundColor: "currentColor",
    marginLeft: "1px",
    verticalAlign: "text-bottom",
    animation: "blink 1s step-end infinite",
  },
  timestamp: { fontSize: "0.6875rem", color: "var(--text-tertiary)", padding: "0 2px" },
};
