"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import MessageBubble from "./MessageBubble";
import StreamingStatusBar from "./StreamingStatusBar";
import PullProgressBar from "@/components/ui/PullProgressBar";
import { lightHaptic } from "@/lib/utils/haptics";
import type { ChatMessage, MessageAttachment, PastedAttachmentData, ReactionEntry } from "@/lib/chat/types";
import type { TaskProgressData } from "@/lib/chat/taskProgress";

const ImageMessage = dynamic(() => import("./ImageMessage"), { ssr: false });
const ImageMessageSkeleton = dynamic(
  () => import("./ImageMessage").then((m) => ({ default: m.ImageMessageSkeleton })),
  { ssr: false }
);
const TaskCard = dynamic(() => import("./TaskCard"), { ssr: false });

export type { ChatMessage, MessageAttachment };

interface MessageListProps {
  messages: ChatMessage[];
  onRefresh?: () => void | Promise<void>;
  userColorHex?: string;
  streamingStatus?: string | null;
  currentUserId?: string;
  onDeleteMessage?: (id: string) => void;
  groupContext?: boolean;
  reactionsMap?: Record<string, ReactionEntry[]>;
  onReact?: (messageId: string, type: string) => void;
}

export default function MessageList({ messages, onRefresh, userColorHex, streamingStatus, currentUserId, onDeleteMessage, reactionsMap, onReact }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const streamingMsg = messages.find((m) => m.isStreaming);
  const isStreamingNow = !!streamingMsg;
  const liveTaskProgress: TaskProgressData | null = streamingMsg?.taskData ?? null;
  const [showScrollButton, setShowScrollButton] = useState(false);
  const userScrolledUp = useRef(false);
  const touchStartY = useRef<number>(-1);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if ((containerRef.current?.scrollTop ?? 1) === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartY.current < 0 || !onRefresh) return;
    const dy = Math.max(0, e.touches[0].clientY - touchStartY.current);
    setPullDistance(dy);
  }

  async function handleTouchEnd() {
    if (pullDistance >= 56 && onRefresh) {
      touchStartY.current = -1;
      setPullDistance(0);
      setIsRefreshing(true);
      lightHaptic();
      await onRefresh();
      setIsRefreshing(false);
    } else {
      setPullDistance(0);
      touchStartY.current = -1;
    }
  }

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

  useEffect(() => {
    scrollToBottom("instant");
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current) {
      scrollToBottom("smooth");
    }
  }, [messages]);

  // When the keyboard appears the input container grows, shrinking this list.
  // scrollTop doesn't auto-adjust, so the last message slides above the fold.
  // Re-anchor to the bottom instantly whenever the visual viewport shrinks.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let lastHeight = vv.height;
    function onViewportResize() {
      const newHeight = vv!.height;
      if (newHeight < lastHeight) {
        scrollToBottom("instant");
      }
      lastHeight = newHeight;
    }
    vv.addEventListener("resize", onViewportResize);
    return () => vv.removeEventListener("resize", onViewportResize);
  }, []);

  return (
    <div style={styles.wrapper}>
      <PullProgressBar pullProgress={Math.min(pullDistance / 56, 1)} refreshing={isRefreshing} />
      <div style={styles.scrollArea}>
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onTouchStart={onRefresh ? handleTouchStart : undefined}
          onTouchMove={onRefresh ? handleTouchMove : undefined}
          onTouchEnd={onRefresh ? handleTouchEnd : undefined}
          style={styles.container}
        >
          <div style={styles.inner}>
            <div style={styles.spacer} />
            {messages.map((msg) => {
              if (msg.role === "system") {
                return (
                  <div key={msg.id} style={styles.systemDivider}>
                    <div style={styles.systemLine} />
                    <span style={styles.systemText}>{msg.content}</span>
                    <div style={styles.systemLine} />
                  </div>
                );
              }
              if (msg.metadata?.content_type === "image") {
                const url = msg.metadata.image_url as string;
                const prompt = (msg.metadata.prompt as string) ?? msg.content;
                const isHD = msg.metadata.quality === "hd";
                if (!url) return <ImageMessageSkeleton key={msg.id} isHD={isHD} />;
                return <ImageMessage key={msg.id} url={url} prompt={prompt} isHD={isHD} />;
              }
              if (msg.taskData || msg.metadata?.content_type === "task") {
                const data = (msg.taskData ?? msg.metadata?.task_data) as TaskProgressData | undefined;
                if (data) {
                  // While streaming: task card lives in StreamingStatusBar, not here.
                  if (msg.isStreaming) return null;
                  return (
                    <div key={msg.id} style={{ padding: "2px 16px" }}>
                      <TaskCard data={data} isStreaming={false} />
                      {msg.content && (
                        <div style={{ paddingTop: "6px", fontSize: "0.9375rem", lineHeight: "1.55", color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
                          {msg.content}
                        </div>
                      )}
                    </div>
                  );
                }
              }
              // Empty streaming message (no content, no task): shown in StreamingStatusBar.
              if (msg.isStreaming && !msg.content) return null;
              {
                // Resolve attachment list: prefer explicit array, then metadata.attachments, then single legacy fields
                const resolvedAttachments: MessageAttachment[] | undefined =
                  msg.attachments ??
                  (msg.metadata?.attachments as MessageAttachment[] | undefined) ??
                  (msg.imageUrl
                    ? [{ url: msg.imageUrl, type: msg.attachmentType ?? "image", filename: msg.attachmentFilename }]
                    : undefined);

                const pastedAttachments =
                  msg.pastedAttachments ??
                  (msg.metadata?.pastedAttachments as PastedAttachmentData[] | undefined);

                return (
                <MessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  timestamp={msg.created_at}
                  isStreaming={msg.isStreaming}
                  interrupted={msg.interrupted}
                  bubbleColorHex={userColorHex}
                  isOwn={
                    currentUserId !== undefined && msg.sender_id !== undefined
                      ? msg.sender_id === currentUserId
                      : undefined
                  }
                  senderName={msg.senderName}
                  senderColorHex={msg.senderColorHex}
                  senderId={msg.sender_id ?? null}
                  attachments={resolvedAttachments}
                  pastedAttachments={pastedAttachments}
                  canDelete={
                    !msg.isStreaming &&
                    !msg.id.startsWith("tmp-") &&
                    currentUserId !== undefined &&
                    msg.sender_id === currentUserId
                  }
                  onDelete={onDeleteMessage ? () => onDeleteMessage(msg.id) : undefined}
                  swipeOpen={openSwipeId === msg.id}
                  onSwipeOpen={() => setOpenSwipeId(msg.id)}
                  showBruceLabel={true}
                  // Reactions render on the message whose id === reactions.message_id,
                  // regardless of role: members can react to any message and Bruce's
                  // react_to_message tool can react to any member message.
                  reactions={reactionsMap?.[msg.id]}
                  onReact={onReact && !msg.id.startsWith("tmp-") ? (type) => onReact(msg.id, type) : undefined}
                />
                );
              }
            })}
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

      <StreamingStatusBar
        streamingStatus={streamingStatus ?? ""}
        taskProgress={liveTaskProgress}
        isStreaming={isStreamingNow}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  scrollArea: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  container: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
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
  systemDivider: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 16px",
  },
  systemLine: {
    flex: 1,
    height: "1px",
    backgroundColor: "var(--border)",
  },
  systemText: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    flexShrink: 0,
    letterSpacing: "0.01em",
  },
};
