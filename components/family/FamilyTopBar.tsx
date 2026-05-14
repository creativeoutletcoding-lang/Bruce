"use client";

import { useChatContext } from "@/components/layout/ChatShell";
import ChatTopBar from "@/components/chat/ChatTopBar";

export default function FamilyTopBar() {
  const { openDrawer } = useChatContext();

  return (
    <ChatTopBar
      centerTitle
      left={
        <button
          className="mobile-only"
          onClick={openDrawer}
          style={iconButton}
          aria-label="Open menu"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      }
      titleIcon={<span style={{ fontSize: "1.125rem", lineHeight: 1 }}>🏠</span>}
      title="Family"
      right={<div style={iconButton} aria-hidden="true" />}
    />
  );
}

const iconButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "36px",
  height: "36px",
  color: "var(--text-secondary)",
  cursor: "pointer",
  borderRadius: "var(--radius-sm)",
  flexShrink: 0,
};
