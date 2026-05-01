"use client";

import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import ImageMessage, { ImageMessageSkeleton } from "./ImageMessage";
import PullProgressBar from "@/components/ui/PullProgressBar";
import { lightHaptic } from "@/lib/utils/haptics";
import type { MessageRole } from "@/lib/types";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at?: string;
  isStreaming?: boolean;
  metadata?: Record<string, unknown>;
}

interface MessageListProps {
  messages: ChatMessage[];
  onRefresh?: () => void | Promise<void>;
}

export default function MessageList({ messages, onRefresh }: MessageListProps) {
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
};
