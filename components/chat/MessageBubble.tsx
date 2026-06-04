"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import { lightHaptic } from "@/lib/utils/haptics";
import { getDisplayName, getProfileColor } from "@/lib/chat/senderProfile";
import type { MessageRole } from "@/lib/types";
import type { MessageAttachment, ReactionEntry } from "@/lib/chat/types";
import type { PastedAttachmentData } from "@/lib/chat/pastedText";
import { stripPastedSummaries } from "@/lib/chat/pastedText";
import AttachmentBlock from "./AttachmentBlock";
import AttachmentViewer, { type ViewerContent } from "./AttachmentViewer";
import MessageContextMenu, { type MenuAnchor } from "./MessageContextMenu";

export type { MessageAttachment };

interface MessageBubbleProps {
  role: MessageRole;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  /** Set when the message was interrupted by the user; renders a muted note. */
  interrupted?: boolean;
  bubbleColorHex?: string;
  isOwn?: boolean;
  senderName?: string;
  senderColorHex?: string;
  /** Sender's user id — used to derive a deterministic fallback color when senderColorHex is null. */
  senderId?: string | null;
  attachments?: MessageAttachment[];
  pastedAttachments?: PastedAttachmentData[];
  // Legacy single-attachment fallback
  imageUrl?: string;
  attachmentType?: string;
  attachmentFilename?: string;
  canDelete?: boolean;
  onDelete?: () => void;
  // Swipe coordination: parent controls whether this swipe is open
  swipeOpen?: boolean;
  onSwipeOpen?: () => void;
  showBruceLabel?: boolean;
  // Reactions
  reactions?: ReactionEntry[];
  onReact?: (type: string) => void;
}

const REVEAL_WIDTH = 80;
const SWIPE_THRESHOLD = 56;
const LONG_PRESS_MS = 500;
const MOVE_THRESHOLD_PX = 4;
const MENU_MOVE_THRESHOLD_PX = 10;

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const ICON_SIZE = 28;

const REACTION_PATHS: Record<string, string> = {
  thumbs_up: "M2 20h2a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H2v9zm18.5-9H14V7a3 3 0 0 0-3-3l-1 6-2.5 2v8h9.1a2 2 0 0 0 1.98-1.7l1.4-7A2 2 0 0 0 20.5 11z",
  heart: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
};

// Renders reaction icons in normal flow BEFORE the bubble. Each reactor gets
// their own colored icon matching the reaction type they used.
// marginBottom: -20px (8px gap + 12px overlap) + zIndex: 1 paints the row
// on top of the bubble below it.
function ReactionRow({ reactions, isUser }: { reactions: ReactionEntry[]; isUser?: boolean }) {
  // Flatten reactors in type order, preserving per-type SVG
  const items: Array<{ colorHex: string | undefined; type: string; key: string }> = [];
  for (const entry of reactions) {
    for (const reactor of entry.reactors) {
      items.push({
        colorHex: reactor.colorHex,
        type: entry.type,
        key: `${entry.type}-${reactor.userId ?? "__bruce__"}`,
      });
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: `${ICON_SIZE}px`,
        marginBottom: "-20px",
        marginRight: isUser ? undefined : "-4px",
        marginLeft: isUser ? "-4px" : undefined,
        position: "relative",
        zIndex: 1,
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: isUser ? "flex-start" : "flex-end",
        pointerEvents: "none",
      }}
    >
      {items.map((item, i) => (
        <svg
          key={item.key}
          width={ICON_SIZE}
          height={ICON_SIZE}
          viewBox="0 0 24 24"
          fill={item.colorHex ?? "#0F6E56"}
          aria-hidden="true"
          style={{
            display: "block",
            flexShrink: 0,
            marginLeft: i === 0 ? 0 : "-8px",
            position: "relative",
            zIndex: i + 1,
            filter: "drop-shadow(0px 1px 3px rgba(0,0,0,0.35))",
          }}
        >
          <path d={REACTION_PATHS[item.type] ?? REACTION_PATHS.thumbs_up} />
        </svg>
      ))}
    </div>
  );
}

export default function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
  interrupted = false,
  bubbleColorHex,
  isOwn,
  senderName,
  senderColorHex,
  senderId,
  attachments,
  pastedAttachments,
  imageUrl,
  attachmentType,
  attachmentFilename,
  canDelete = false,
  onDelete,
  swipeOpen = false,
  onSwipeOpen,
  showBruceLabel = false,
  reactions,
  onReact,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [viewer, setViewer] = useState<ViewerContent | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const msgGroupRef = useRef<HTMLDivElement>(null);

  // ── Swipe state ──────────────────────────────────────────────────────────────
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const swipeOffsetRef = useRef(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const startOffset = useRef(0);
  const isDragging = useRef(false);
  const gestureAborted = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartX = useRef(0);
  const pointerStartY = useRef(0);

  const isTouchDevice = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  useEffect(() => { swipeOffsetRef.current = swipeOffset; }, [swipeOffset]);

  // Close this swipe when the parent opens a different one
  useEffect(() => {
    if (!swipeOpen && swipeOffsetRef.current !== 0) {
      setIsSwiping(false);
      setSwipeOffset(0);
    }
  }, [swipeOpen]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    function dismiss(e: Event) {
      if (ctxMenuRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    }
    const timerId = setTimeout(() => {
      document.addEventListener("mousedown", dismiss);
    }, 0);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("mousedown", dismiss);
    };
  }, [ctxMenu]);

  // Desktop right-click — on touch devices the long-press menu is used instead.
  function handleContextMenu(e: React.MouseEvent) {
    if (isTouchDevice) return;
    const hasActions = canDelete || !!onReact;
    if (!hasActions) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  // ── Swipe touch handlers (delete reveal) ────────────────────────────────────
  function handleSwipeTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    isDragging.current = false;
    gestureAborted.current = false;

    if (canDelete) {
      startOffset.current = swipeOffsetRef.current;
    }
    // Long-press is handled by pointer event handlers below.
  }

  function handleSwipeTouchMove(e: React.TouchEvent) {
    if (gestureAborted.current) return;
    const t = e.touches[0];
    const totalDx = t.clientX - touchStartX.current;
    const totalDy = t.clientY - touchStartY.current;

    if (!canDelete) return;

    if (!isDragging.current) {
      if (Math.abs(totalDx) < MOVE_THRESHOLD_PX && Math.abs(totalDy) < MOVE_THRESHOLD_PX) return;
      if (Math.abs(totalDy) > Math.abs(totalDx)) {
        gestureAborted.current = true;
        return;
      }
      isDragging.current = true;
      onSwipeOpen?.();
    }

    const newOffset = Math.max(-REVEAL_WIDTH, Math.min(0, startOffset.current + totalDx));
    setIsSwiping(true);
    setSwipeOffset(newOffset);
  }

  function handleSwipeTouchEnd() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!canDelete || !isDragging.current) {
      if (canDelete && swipeOffsetRef.current < 0) {
        setIsSwiping(false);
        setSwipeOffset(0);
      }
      return;
    }
    isDragging.current = false;
    setIsSwiping(false);
    const currentOffset = swipeOffsetRef.current;
    if (currentOffset < -SWIPE_THRESHOLD) {
      lightHaptic();
      setSwipeOffset(-REVEAL_WIDTH);
    } else {
      setSwipeOffset(0);
    }
  }

  function handleSwipeTouchCancel() {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    isDragging.current = false;
    gestureAborted.current = false;
    setIsSwiping(false);
    setSwipeOffset(0);
  }

  // ── Long-press pointer handlers (touch-only, opens context menu) ─────────────
  function handlePointerDown(e: React.PointerEvent) {
    if (!isTouchDevice || e.pointerType !== "touch") return;
    pointerStartX.current = e.clientX;
    pointerStartY.current = e.clientY;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      const el = msgGroupRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      lightHaptic();
      setMenuAnchor({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width });
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!longPressTimer.current) return;
    const dx = e.clientX - pointerStartX.current;
    const dy = e.clientY - pointerStartY.current;
    if (Math.sqrt(dx * dx + dy * dy) > MENU_MOVE_THRESHOLD_PX) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handlePointerUp() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handlePointerCancel() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  const isUser = isOwn !== undefined ? isOwn : role === "user";
  const isHumanMessage = role === "user";
  const showSenderLabel = isOwn === false && isHumanMessage && Boolean(senderName);
  const resolvedSenderColor = getProfileColor(senderId ?? null, senderColorHex ?? null);
  const resolvedOwnColor = getProfileColor(null, bubbleColorHex ?? null);

  // Resolve file attachment list: prefer explicit array, fall back to single legacy fields
  const resolvedAttachments: MessageAttachment[] =
    attachments ??
    (imageUrl ? [{ url: imageUrl, type: attachmentType ?? "image", filename: attachmentFilename }] : []);

  const imageAttachments = resolvedAttachments.filter((a) => a.type === "image");
  const docAttachments = resolvedAttachments.filter((a) => a.type === "document");
  const hasPasted = Boolean(pastedAttachments && pastedAttachments.length > 0);

  const displayContent = hasPasted ? stripPastedSummaries(content) : content;
  const hasReactions = reactions && reactions.length > 0;

  return (
    <div style={{ position: "relative", overflowX: "clip" }}>
      {/* Delete button — revealed by swipe, sits behind the content layer */}
      {canDelete && (
        <button
          style={styles.deleteReveal}
          onClick={() => { setSwipeOffset(0); onDelete?.(); }}
          aria-label="Delete message"
        >
          Delete
        </button>
      )}

      {/* Content row — translates left to reveal delete button */}
      <div
        className="message-bubble"
        style={{
          ...styles.wrapper,
          justifyContent: isUser ? "flex-end" : "flex-start",
          transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
          transition: isSwiping ? "none" : "transform 0.2s cubic-bezier(0.25,0.46,0.45,0.94)",
          position: "relative",
          zIndex: 1,
          backgroundColor: "var(--bg-primary)",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onTouchStart={handleSwipeTouchStart}
        onTouchMove={handleSwipeTouchMove}
        onTouchEnd={handleSwipeTouchEnd}
        onTouchCancel={handleSwipeTouchCancel}
        onContextMenu={handleContextMenu}
        onPointerDown={isTouchDevice ? handlePointerDown : undefined}
        onPointerMove={isTouchDevice ? handlePointerMove : undefined}
        onPointerUp={isTouchDevice ? handlePointerUp : undefined}
        onPointerCancel={isTouchDevice ? handlePointerCancel : undefined}
      >
      <div ref={msgGroupRef} className="msg-group" data-role={role} style={{ ...styles.messageGroup, ...(isHumanMessage ? { maxWidth: "85%", alignItems: isUser ? "flex-end" : "flex-start" } : { width: "100%" }) }}>
        {showBruceLabel && role === "assistant" && !isStreaming && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", padding: "0 2px", marginBottom: "2px" }}>
            Bruce
          </div>
        )}
        {showSenderLabel && (
          <div style={{ fontSize: "0.75rem", fontWeight: 500, color: resolvedSenderColor, padding: "0 2px", marginBottom: "2px" }}>
            {getDisplayName(senderName)}
          </div>
        )}

        {/* Pasted text attachment blocks */}
        {hasPasted && pastedAttachments!.map((att, i) => (
          <AttachmentBlock
            key={i}
            type="pasted_text"
            label="Pasted text"
            meta={`${att.wordCount} words · ${att.lineCount} lines`}
            onClick={() => setViewer({ type: "pasted_text", content: att.content, wordCount: att.wordCount, lineCount: att.lineCount, title: "Pasted text" })}
          />
        ))}

        {/* Image attachments — tappable thumbnail */}
        {imageAttachments.length > 0 && (
          <div style={{
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
            justifyContent: isUser ? "flex-end" : "flex-start",
          }}>
            {imageAttachments.map((img, i) => (
              <button
                key={i}
                onClick={() => setViewer({ type: "image", url: img.url, title: img.filename ?? "Image" })}
                style={styles.imageBtnWrapper}
                type="button"
                aria-label="View image"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
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
              </button>
            ))}
          </div>
        )}

        {/* Document attachment blocks */}
        {docAttachments.length > 0 && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            alignItems: isUser ? "flex-end" : "flex-start",
          }}>
            {docAttachments.map((doc, i) => (
              <AttachmentBlock
                key={i}
                type="document"
                label={doc.filename ?? "Document"}
                onClick={() => doc.url ? setViewer({ type: "document", url: doc.url, title: doc.filename ?? "Document" }) : undefined}
              />
            ))}
          </div>
        )}

        {/* Reaction icons — rendered before the bubble in flow so no
            absolute positioning is needed. The row overlaps the bubble's
            top corner via marginBottom: -22px + zIndex: 1. */}
        {hasReactions && (
          <ReactionRow reactions={reactions!} isUser={isUser} />
        )}

        {/* Bubble */}
        {displayContent && (
          <div
            className={isHumanMessage ? "bubble-tint" : undefined}
            style={
              isHumanMessage
                ? {
                    ...styles.bubble,
                    whiteSpace: "pre-wrap",
                    ["--bubble-color" as string]: isUser ? resolvedOwnColor : resolvedSenderColor,
                    ...(isUser
                      ? { borderRight: `2.5px solid ${resolvedOwnColor}`, borderRadius: "10px 0 0 10px" }
                      : { borderLeft: `2.5px solid ${resolvedSenderColor}`, borderRadius: "0 10px 10px 0" }),
                    color: "var(--text-primary)",
                  }
                : styles.assistantContent
            }
          >
            {role === "assistant" ? (
              <div
                className="bruce-md"
                dangerouslySetInnerHTML={{ __html: marked(displayContent) as string }}
              />
            ) : (
              <span style={styles.content}>{displayContent}</span>
            )}
            {interrupted && (
              <div style={styles.interruptedNote}>Stopped</div>
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
      </div>

      {/* Floating context menu — portal to body (desktop right-click) */}
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
            width: "fit-content",
          }}
        >
          {onReact && (
            <>
              <button
                style={styles.contextMenuItem}
                onClick={() => { setCtxMenu(null); onReact("thumbs_up"); }}
              >
                👍
              </button>
              <button
                style={styles.contextMenuItem}
                onClick={() => { setCtxMenu(null); onReact("heart"); }}
              >
                ❤️
              </button>
            </>
          )}
          {canDelete && (
            <button
              style={{ ...styles.contextMenuItem, color: "#c0392b" }}
              onClick={() => { setCtxMenu(null); onDelete?.(); }}
            >
              Delete
            </button>
          )}
        </div>,
        document.body
      )}

      {/* Long-press context menu (touch devices) */}
      {menuOpen && menuAnchor && (
        <MessageContextMenu
          anchor={menuAnchor}
          content={displayContent}
          onClose={() => setMenuOpen(false)}
          reactions={reactions}
          onReact={onReact}
        />
      )}

      <AttachmentViewer content={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: "flex", padding: "2px 16px" },
  deleteReveal: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: `${REVEAL_WIDTH}px`,
    backgroundColor: "#c0392b",
    color: "#ffffff",
    fontSize: "0.875rem",
    fontWeight: "600",
    border: "none",
    cursor: "pointer",
    zIndex: 0,
    letterSpacing: "0.01em",
  },
  messageGroup: { display: "flex", flexDirection: "column", gap: "8px" },
  bubble: {
    padding: "10px 14px",
    borderRadius: "var(--radius-lg)",
    fontSize: "0.9375rem",
    lineHeight: "1.55",
    wordBreak: "break-word",
  },
  assistantContent: {
    fontSize: "0.9375rem",
    lineHeight: "1.55",
    wordBreak: "break-word" as const,
    color: "var(--text-primary)",
    padding: "8px 0",
    width: "100%",
  },
  interruptedNote: {
    marginTop: "6px",
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    fontStyle: "italic" as const,
    lineHeight: 1.3,
  },
  content: { display: "inline" },
  timestamp: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    padding: "0 2px",
  },
  contextMenuItem: {
    display: "block",
    width: "100%",
    padding: "10px 14px",
    textAlign: "left" as const,
    fontSize: "0.875rem",
    fontWeight: "500",
    cursor: "pointer",
    backgroundColor: "transparent",
    transition: "background-color var(--transition)",
    border: "none",
    color: "var(--text-primary)",
    whiteSpace: "nowrap" as const,
  },
  imageBtnWrapper: {
    display: "block",
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    borderRadius: "var(--radius-lg)",
  },
};
