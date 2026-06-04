"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactionEntry } from "@/lib/chat/types";

export interface MenuAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

interface MessageContextMenuProps {
  anchor: MenuAnchor;
  content: string;
  onClose: () => void;
  reactions?: ReactionEntry[];
  onReact?: (type: string) => void;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*{2,3}([^*]+)\*{2,3}/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{2}([^_]+)_{2}/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^[-*_]{3,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MENU_WIDTH = 168;

export default function MessageContextMenu({
  anchor,
  content,
  onClose,
  reactions,
  onReact,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const hasReacted = reactions?.find((r) => r.type === "thumbs_up")?.hasCurrentUser ?? false;

  const menuHeightEst = onReact ? 92 : 46;
  const positionAbove = anchor.top > menuHeightEst + 24;
  const menuTop = positionAbove ? anchor.top - menuHeightEst - 8 : anchor.bottom + 8;
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 375;
  const menuLeft = Math.max(
    8,
    Math.min(anchor.left + anchor.width / 2 - MENU_WIDTH / 2, viewportW - MENU_WIDTH - 8)
  );

  function handleCopy() {
    const plain = stripMarkdown(content);
    navigator.clipboard.writeText(plain).catch(() => { /* silent */ });
    onClose();
  }

  function handleReact() {
    onReact?.("thumbs_up");
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      {/* Transparent backdrop — tap anywhere outside to dismiss */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9998 }}
        onPointerDown={onClose}
        aria-hidden="true"
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Message actions"
        style={{
          position: "fixed",
          top: menuTop,
          left: menuLeft,
          width: MENU_WIDTH,
          zIndex: 9999,
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        {onReact && (
          <button
            role="menuitem"
            type="button"
            style={{
              ...styles.item,
              backgroundColor: hasReacted
                ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                : undefined,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleReact}
            aria-label={hasReacted ? "Remove thumbs up" : "Thumbs up"}
          >
            <span style={styles.icon} aria-hidden="true">👍</span>
            <span
              style={{
                ...styles.label,
                color: hasReacted ? "var(--accent)" : "var(--text-primary)",
              }}
            >
              {hasReacted ? "Remove" : "Like"}
            </span>
          </button>
        )}
        {onReact && <div style={styles.divider} aria-hidden="true" />}
        <button
          role="menuitem"
          type="button"
          style={styles.item}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleCopy}
          aria-label="Copy message text"
        >
          <span style={styles.icon}>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
              <rect x="4.5" y="2.5" width="8" height="10" rx="1.25" stroke="currentColor" strokeWidth="1.2" />
              <path
                d="M2.5 4.5H2A1.5 1.5 0 0 0 .5 6v7A1.5 1.5 0 0 0 2 14.5h6A1.5 1.5 0 0 0 9.5 13v-.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span style={styles.label}>Copy</span>
        </button>
      </div>
    </>,
    document.body
  );
}

const styles: Record<string, React.CSSProperties> = {
  item: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "11px 14px",
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left" as const,
  },
  icon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1rem",
    lineHeight: 1,
    flexShrink: 0,
    color: "var(--text-secondary)",
    width: "20px",
  },
  label: {
    fontSize: "0.9375rem",
    fontWeight: "400",
    lineHeight: 1.2,
  },
  divider: {
    height: "1px",
    backgroundColor: "var(--border)",
    margin: "0 14px",
  },
};
