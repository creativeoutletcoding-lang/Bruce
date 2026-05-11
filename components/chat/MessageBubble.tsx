"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import { lightHaptic } from "@/lib/utils/haptics";
import type { MessageRole } from "@/lib/types";

export interface MessageAttachment {
  url: string;
  type: string;
  filename?: string;
}

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
  attachments?: MessageAttachment[];
  // Legacy single-attachment fallback
  imageUrl?: string;
  attachmentType?: string;
  attachmentFilename?: string;
  canDelete?: boolean;
  onDelete?: () => void;
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
  attachments,
  imageUrl,
  attachmentType,
  attachmentFilename,
  canDelete = false,
  onDelete,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActive = useRef(false);

  // ── Dismiss context menu on outside click/touch (same pattern as Sidebar) ──
  useEffect(() => {
    if (!ctxMenu) return;
    function dismiss(e: Event) {
      if (ctxMenuRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    }
    const timerId = setTimeout(() => {
      document.addEventListener("mousedown", dismiss);
      document.addEventListener("touchstart", dismiss, { passive: true });
    }, 0);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("touchstart", dismiss);
    };
  }, [ctxMenu]);

  function handleLongPressStart(e: React.TouchEvent) {
    if (!canDelete) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimer.current = setTimeout(() => {
      lightHaptic();
      longPressActive.current = true;
      setCtxMenu({ x, y });
      longPressTimer.current = null;
    }, 500);
  }

  function handleLongPressMove() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleLongPressEnd(e: React.TouchEvent) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressActive.current) {
      e.preventDefault();
      longPressActive.current = false;
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    if (!canDelete) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  const isUser = isOwn !== undefined ? isOwn : role === "user";
  const isHumanMessage = role === "user";
  const showSenderLabel = isOwn === false && isHumanMessage && Boolean(senderName);
  const showDots = isStreaming && !content;

  // Resolve attachment list: prefer explicit array, fall back to single legacy fields
  const resolvedAttachments: MessageAttachment[] =
    attachments ??
    (imageUrl ? [{ url: imageUrl, type: attachmentType ?? "image", filename: attachmentFilename }] : []);

  const imageAttachments = resolvedAttachments.filter((a) => a.type === "image");
  const docAttachments = resolvedAttachments.filter((a) => a.type === "document");

  return (
    <div
      style={{ ...styles.wrapper, justifyContent: isUser ? "flex-end" : "flex-start" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={handleLongPressStart}
      onTouchMove={handleLongPressMove}
      onTouchEnd={handleLongPressEnd}
      onContextMenu={handleContextMenu}
    >
      <div className="msg-group" data-role={role} style={{ ...styles.messageGroup, ...(isUser ? {} : { width: "100%" }) }}>
        {showSenderLabel && (
          <div style={{ fontSize: "0.6875rem", fontWeight: 500, color: senderColorHex ?? "var(--text-secondary)", padding: "0 2px", marginBottom: "1px" }}>
            {senderName}
          </div>
        )}
        {/* Images rendered directly in thread — no bubble wrapper */}
        {imageAttachments.length > 0 && (
          <div style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            justifyContent: isUser ? "flex-end" : "flex-start",
          }}>
            {imageAttachments.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={img.url}
                alt=""
                style={{
                  maxWidth: "260px",
                  width: imageAttachments.length > 1 ? "128px" : undefined,
                  height: imageAttachments.length > 1 ? "128px" : "auto",
                  borderRadius: "var(--radius-lg)",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            ))}
          </div>
        )}

        {/* Doc chips rendered directly in thread — no bubble wrapper */}
        {docAttachments.length > 0 && (
          <div style={{
            display: "flex",
            gap: "4px",
            flexWrap: "wrap",
            justifyContent: isUser ? "flex-end" : "flex-start",
          }}>
            {docAttachments.map((doc, i) => (
              <div key={i} style={styles.docChip}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--text-secondary)" }}>
                  <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span style={styles.docChipName}>{doc.filename ?? "Document"}</span>
              </div>
            ))}
          </div>
        )}

        {/* Bubble only when there is text content or streaming dots */}
        {(showDots || content) && (
          <div
            style={
              isHumanMessage
                ? {
                    ...styles.bubble,
                    whiteSpace: "pre-wrap",
                    ...styles.userBubble,
                    backgroundColor: isUser
                      ? (bubbleColorHex ?? "var(--accent)")
                      : (senderColorHex ?? "var(--accent)"),
                  }
                : styles.assistantContent
            }
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
              role === "assistant" ? (
                <div
                  className="bruce-md"
                  dangerouslySetInnerHTML={{ __html: marked(content) as string }}
                />
              ) : (
                <span style={styles.content}>{content}</span>
              )
            )}
          </div>
        )}
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

      {/* Floating context menu — portal to body, same pattern as Sidebar */}
      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{
            position: "fixed",
            top: ctxMenu.y,
            left: ctxMenu.x,
            zIndex: 9999,
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
            overflow: "hidden",
            minWidth: "130px",
          }}
        >
          <button
            style={styles.contextMenuItem}
            onClick={() => { setCtxMenu(null); onDelete?.(); }}
          >
            Delete
          </button>
        </div>,
        document.body
      )}
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
  },
  userBubble: { color: "#ffffff", borderBottomRightRadius: "4px" },
  assistantContent: {
    fontSize: "0.9375rem",
    lineHeight: "1.55",
    wordBreak: "break-word" as const,
    color: "var(--text-primary)",
    padding: "8px 0",
    width: "100%",
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
  contextMenuItem: {
    width: "100%",
    padding: "10px 14px",
    textAlign: "left" as const,
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#c0392b",
    cursor: "pointer",
    backgroundColor: "transparent",
    transition: "background-color var(--transition)",
    display: "block",
    border: "none",
  },
  docChip: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "var(--radius-sm)",
    border: "0.5px solid var(--border-strong)",
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-secondary)",
  },
  docChipName: {
    fontSize: "0.8125rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "180px",
    color: "var(--text-primary)",
  },
};
