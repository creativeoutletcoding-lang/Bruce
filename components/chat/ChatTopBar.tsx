"use client";

import type { ReactNode } from "react";

interface ChatTopBarProps {
  /** Left slot — typically a hamburger or back button. */
  left?: ReactNode;
  /** Optional icon shown to the left of the title (project icon, family emoji). */
  titleIcon?: ReactNode;
  /** The main title. Truncates with ellipsis. */
  title: ReactNode;
  /** Right slot — model picker, incognito toggle, avatar stack, menu. */
  right?: ReactNode;
  /** When true, the title is centered absolutely and ignores siblings (used by FamilyTopBar). */
  centerTitle?: boolean;
}

// The single chat top bar. Every chat context composes this with its own
// left/right slots — visual changes (height, border, padding) must be made
// here, not in the context-specific wrappers (see CLAUDE.md CHAT UI RULE).
export default function ChatTopBar({ left, titleIcon, title, right, centerTitle = false }: ChatTopBarProps) {
  return (
    <div style={styles.bar}>
      {left ?? <span style={styles.leftSpacer} aria-hidden="true" />}
      {centerTitle ? (
        <>
          <div style={styles.titleGroupCenter}>
            {titleIcon}
            <span style={styles.titleCentered}>{title}</span>
          </div>
          <div style={styles.flexSpacer} aria-hidden="true" />
        </>
      ) : (
        <div style={styles.titleGroupInline}>
          {titleIcon}
          <h1 style={styles.title}>{title}</h1>
        </div>
      )}
      {right}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    height: "var(--topbar-height)",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    gap: "8px",
    flexShrink: 0,
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    position: "relative",
  },
  leftSpacer: {
    width: "0px",
    flexShrink: 0,
  },
  titleGroupInline: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  titleGroupCenter: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    display: "flex",
    alignItems: "center",
    gap: "7px",
    pointerEvents: "none",
  },
  titleCentered: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: "0.9375rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  flexSpacer: {
    flex: 1,
  },
};
