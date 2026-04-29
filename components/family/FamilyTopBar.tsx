"use client";

import { useChatContext } from "@/components/layout/ChatShell";

export default function FamilyTopBar() {
  const { openDrawer } = useChatContext();

  return (
    <div style={styles.bar}>
      {/* Mobile hamburger */}
      <button
        className="mobile-only"
        onClick={openDrawer}
        style={styles.iconButton}
        aria-label="Open menu"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* Title */}
      <div style={styles.titleGroup}>
        <span style={styles.emoji}>🏠</span>
        <span style={styles.title}>Family</span>
      </div>

      {/* Right spacer so title stays centered */}
      <div style={styles.iconButton} aria-hidden="true" />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: "var(--topbar-height)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    flexShrink: 0,
  },
  titleGroup: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: "7px",
    pointerEvents: "none",
  },
  emoji: {
    fontSize: "1.125rem",
    lineHeight: 1,
  },
  title: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
  },
  iconButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    flexShrink: 0,
  },
};
