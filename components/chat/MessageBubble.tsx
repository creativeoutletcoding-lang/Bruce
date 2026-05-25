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

export type { MessageAttachment };

interface MessageBubbleProps {
  role: MessageRole;
  content: string;
  timestamp?: string;
  isStreaming?: boolean;
  /** Set when the message was interrupted by the user; renders a muted note. */
  interrupted?: boolean;
  workingStatus?: string | null;
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
const REACTION_HINT_TTL_MS = 3000;

function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const ICON_SIZE = 28;
const ICON_STEP = 20; // 28px icon - 8px overlap

function ReactionOverlay({
  reactions,
  isUser,
  isHumanMessage,
  onReact,
  disabled,
}: {
  reactions: ReactionEntry[];
  isUser: boolean;
  isHumanMessage: boolean;
  onReact: (type: string) => void;
  disabled?: boolean;
}) {
  // Collect unique reactors across all reaction types, preserving order
  const seen = new Set<string>();
  const uniqueReactors: { userId: string | null; colorHex?: string }[] = [];
  for (const entry of reactions) {
    for (const reactor of entry.reactors) {
      const key = reactor.userId ?? "__bruce__";
      if (!seen.has(key)) {
        seen.add(key);
        uniqueReactors.push(reactor);
      }
    }
  }

  const totalWidth = ICON_SIZE + (uniqueReactors.length - 1) * ICON_STEP;

  const cornerStyle: React.CSSProperties = isHumanMessage
    ? isUser
      ? { right: "8px" }
      : { left: "8px" }
    : { left: "0" };

  const reactionType = reactions[0]?.type ?? "thumbs_up";

  return (
    <button
      type="button"
      onClick={() => !disabled && onReact(reactionType)}
      disabled={disabled}
      style={{
        position: "absolute",
        top: "-14px",
        ...cornerStyle,
        width: `${totalWidth}px`,
        height: `${ICON_SIZE}px`,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        zIndex: 10,
      }}
      aria-label={`${uniqueReactors.length} reaction${uniqueReactors.length !== 1 ? "s" : ""} — tap to react`}
    >
      {uniqueReactors.map((reactor, i) => (
        <svg
          key={reactor.userId ?? "__bruce__"}
          width={ICON_SIZE}
          height={ICON_SIZE}
          viewBox="0 0 24 24"
          fill={reactor.colorHex ?? "#0F6E56"}
          aria-hidden="true"
          style={{
            position: "absolute",
            left: `${i * ICON_STEP}px`,
            zIndex: i + 1,
          }}
        >
          <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
        </svg>
      ))}
    </button>
  );
}

export default function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
  interrupted = false,
  workingStatus,
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
  const [showReactionHint, setShowReactionHint] = useState(false);
  const [reactionHintPos, setReactionHintPos] = useState({ x: 0, y: 0 });
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const reactionHintRef = useRef<HTMLDivElement>(null);

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
  const reactionHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Dismiss reaction hint on outside click/tap (with delay so the long-press
  // touchend doesn't immediately close it)
  useEffect(() => {
    if (!showReactionHint) return;
    function dismiss(e: Event) {
      if (reactionHintRef.current?.contains(e.target as Node)) return;
      setShowReactionHint(false);
    }
    const timerId = setTimeout(() => {
      document.addEventListener("mousedown", dismiss);
      document.addEventListener("touchstart", dismiss);
    }, 300);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("touchstart", dismiss);
    };
  }, [showReactionHint]);

  // Desktop right-click — on touch devices native text selection proceeds.
  function handleContextMenu(e: React.MouseEvent) {
    const hasActions = canDelete || !!onReact;
    if (!hasActions) return;
    const isTouchDevice = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (isTouchDevice) return;
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  }

  // ── Swipe + long-press touch handlers ────────────────────────────────────────
  function handleSwipeTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
    isDragging.current = false;
    gestureAborted.current = false;

    if (canDelete) {
      startOffset.current = swipeOffsetRef.current;
    }

    // Long-press fires after LONG_PRESS_MS if no significant movement
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      if (!isDragging.current && !gestureAborted.current && onReact) {
        lightHaptic();
        setReactionHintPos({ x: touchStartX.current, y: touchStartY.current });
        setShowReactionHint(true);
        reactionHintTimer.current = setTimeout(() => setShowReactionHint(false), REACTION_HINT_TTL_MS);
      }
    }, LONG_PRESS_MS);
  }

  function handleSwipeTouchMove(e: React.TouchEvent) {
    if (gestureAborted.current) return;
    const t = e.touches[0];
    const totalDx = t.clientX - touchStartX.current;
    const totalDy = t.clientY - touchStartY.current;
    const totalMovement = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

    if (longPressTimer.current !== null && totalMovement > MOVE_THRESHOLD_PX) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

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

  const isUser = isOwn !== undefined ? isOwn : role === "user";
  const isHumanMessage = role === "user";
  const showSenderLabel = isOwn === false && isHumanMessage && Boolean(senderName);
  const showDots = isStreaming && !content;
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
      >
      <div className="msg-group" data-role={role} style={{ ...styles.messageGroup, ...(isHumanMessage ? { maxWidth: "85%", alignItems: isUser ? "flex-end" : "flex-start" } : { width: "100%" }) }}>
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

        {/* Bubble wrapper — position:relative anchors the reaction overlay to this element */}
        {(showDots || displayContent) && (
          <div style={{ position: "relative", display: "inline-block", ...(hasReactions ? { marginTop: "20px" } : {}) }}>
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
              {showDots ? (
                <span style={styles.dotsRow}>
                  <span style={styles.dot1} />
                  <span style={styles.dot2} />
                  <span style={styles.dot3} />
                </span>
              ) : (
                role === "assistant" ? (
                  <div
                    className="bruce-md"
                    dangerouslySetInnerHTML={{ __html: marked(displayContent) as string }}
                  />
                ) : (
                  <span style={styles.content}>{displayContent}</span>
                )
              )}
              {interrupted && (
                <div style={styles.interruptedNote}>Stopped</div>
              )}
            </div>

            {/* iMessage-style reaction overlay — stacked profile color circles */}
            {hasReactions && onReact && (
              <ReactionOverlay
                reactions={reactions!}
                isUser={isUser}
                isHumanMessage={isHumanMessage}
                onReact={onReact}
                disabled={isStreaming}
              />
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
            <button
              style={styles.contextMenuItem}
              onClick={() => { setCtxMenu(null); onReact("thumbs_up"); }}
            >
              👍
            </button>
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

      {/* Reaction hint — portal to body (mobile long-press) */}
      {showReactionHint && onReact && createPortal(
        <div
          ref={reactionHintRef}
          style={{
            position: "fixed",
            top: Math.max(8, reactionHintPos.y - 56),
            left: Math.max(8, reactionHintPos.x - 24),
            zIndex: 9999,
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-full)",
            boxShadow: "var(--shadow-lg)",
            padding: "8px 14px",
            display: "flex",
            gap: "8px",
          }}
        >
          <button
            type="button"
            style={{
              fontSize: "1.375rem",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              lineHeight: 1,
              padding: 0,
            }}
            onClick={() => {
              setShowReactionHint(false);
              if (reactionHintTimer.current) clearTimeout(reactionHintTimer.current);
              onReact("thumbs_up");
            }}
            aria-label="React with thumbs up"
          >
            👍
          </button>
        </div>,
        document.body
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
