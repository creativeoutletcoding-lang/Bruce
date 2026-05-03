"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import MessageBubble from "./MessageBubble";
import PullProgressBar from "@/components/ui/PullProgressBar";
import { lightHaptic } from "@/lib/utils/haptics";
import type { MessageRole } from "@/lib/types";

const ImageMessage = dynamic(() => import("./ImageMessage"), { ssr: false });
const ImageMessageSkeleton = dynamic(
  () => import("./ImageMessage").then((m) => ({ default: m.ImageMessageSkeleton })),
  { ssr: false }
);

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at?: string;
  isStreaming?: boolean;
  metadata?: Record<string, unknown>;
  imageUrl?: string;
  attachmentType?: string;
  attachmentFilename?: string;
  sender_id?: string | null;
  senderName?: string;
  senderColorHex?: string;
}

interface MessageListProps {
  messages: ChatMessage[];
  onRefresh?: () => void | Promise<void>;
  userColorHex?: string;
  streamingStatus?: string | null;
  currentUserId?: string;
}

export default function MessageList({ messages, onRefresh, userColorHex, streamingStatus, currentUserId }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const userScrolledUp = useRef(false);
  const touchStartY = useRef<number>(-1);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  return (
    <div style={styles.wrapper}>
      <PullProgressBar pullProgress={Math.min(pullDistance / 56, 1)} refreshing={isRefreshing} />
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
            return (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                timestamp={msg.created_at}
                isStreaming={msg.isStreaming}
                workingStatus={msg.isStreaming ? streamingStatus : undefined}
                bubbleColorHex={userColorHex}
                isOwn={
                  currentUserId !== undefined && msg.sender_id !== undefined
                    ? msg.sender_id === currentUserId
                    : undefined
                }
                senderName={msg.senderName}
                senderColorHex={msg.senderColorHex}
                imageUrl={msg.imageUrl ?? (msg.metadata?.image_url as string | undefined)}
                attachmentType={msg.attachmentType}
                attachmentFilename={msg.attachmentFilename}
              />
            );
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
