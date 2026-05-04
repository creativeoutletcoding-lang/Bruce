"use client";

import { useState } from "react";
import type { MessageRole } from "@/lib/types";

interface MessageBubbleProps {
  role: MessageRole;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  workingStatus?: string | null;
  bubbleColorHex?: string;
  isOwn?: boolean;
  senderName?: string;
  senderColorHex?: string;
  imageUrl?: string;
  attachmentType?: string;
  attachmentFilename?: string;
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
  workingStatus,
  bubbleColorHex,
  isOwn,
  senderName,
  senderColorHex,
  imageUrl,
  attachmentType,
  attachmentFilename,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  // isOwn=undefined means standalone chat (fall back to role); isOwn=true/false means project group chat
  const isUser = isOwn !== undefined ? isOwn : role === "user";
  const isHumanMessage = role === "user";
  const showSenderLabel = isOwn === false && isHumanMessage && Boolean(senderName);
  // Show dots inside the same bubble element — never swap elements, which causes flash/remount
  const showDots = isStreaming && !content;

  return (
    <div
      style={{ ...styles.wrapper, justifyContent: isUser ? "flex-end" : "flex-start" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="msg-group" style={styles.messageGroup}>
        {showSenderLabel && (
          <div style={{ fontSize: "0.6875rem", fontWeight: 500, color: senderColorHex ?? "var(--text-secondary)", padding: "0 2px", marginBottom: "1px" }}>
            {senderName}
          </div>
        )}
        <div
          style={{
            ...styles.bubble,
            ...(isHumanMessage
              ? {
                  ...styles.userBubble,
                  backgroundColor: isUser
                    ? (bubbleColorHex ?? "var(--accent)")
                    : (senderColorHex ?? "var(--accent)"),
                }
              : styles.assistantBubble),
          }}
        >
          {showDots ? (
            <span style={{ display: "inline-flex", flexDirection: "column", gap: "4px" }}>
              <span style={styles.dotsRow}>
                <span style={styles.dot1} />
                <span style={styles.dot2} />
                <span style={styles.dot3} />
              </span>
              {workingStatus && (
                <span style={styles.indicatorStatus}>{workingStatus}</span>
              )}
            </span>
          ) : (
            <>
              {imageUrl && attachmentType === "document" ? (
                <div style={styles.docChip}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                    <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span style={styles.docChipName}>{attachmentFilename ?? "Document"}</span>
                </div>
              ) : imageUrl ? (
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
              ) : null}
              {content && <span style={styles.content}>{content}</span>}
            </>
          )}
        </div>
        {timestamp && (
          <div
            className="msg-timestamp"
            style={{
              ...styles.timestamp,
              textAlign: isUser ? "right" : "left",
              visibility: hovered ? "visible" : "hidden",
            }}
          >
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
  dotsRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  dot1: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "var(--text-tertiary)",
    animation: "dotFade 1.2s ease-in-out infinite",
    animationDelay: "0ms",
  },
  dot2: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "var(--text-tertiary)",
    animation: "dotFade 1.2s ease-in-out infinite",
    animationDelay: "150ms",
  },
  dot3: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "var(--text-tertiary)",
    animation: "dotFade 1.2s ease-in-out infinite",
    animationDelay: "300ms",
  },
  indicatorStatus: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    lineHeight: 1.3,
  },
  content: { display: "inline" },
  timestamp: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    padding: "0 2px",
  },
  docChip: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.1)",
    marginBottom: "6px",
  },
  docChipName: {
    fontSize: "0.8125rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "180px",
  },
};
