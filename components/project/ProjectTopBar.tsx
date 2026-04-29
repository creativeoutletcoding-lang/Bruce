"use client";

import { useRouter } from "next/navigation";
import { useChatContext } from "@/components/layout/ChatShell";

interface ProjectTopBarProps {
  projectId: string;
  projectName: string;
  projectIcon: string;
}

export default function ProjectTopBar({
  projectId,
  projectName,
  projectIcon,
}: ProjectTopBarProps) {
  const router = useRouter();
  const { openDrawer } = useChatContext();

  return (
    <div style={styles.topBar}>
      {/* Hamburger — mobile only */}
      <button
        onClick={openDrawer}
        style={styles.hamburger}
        aria-label="Open menu"
        className="mobile-only"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M2 4h14M2 9h14M2 14h14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* Back to project */}
      <button
        onClick={() => router.push(`/projects/${projectId}`)}
        style={styles.backButton}
        aria-label="Back to project"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path
            d="M11 4L5 9l6 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div style={styles.projectInfo}>
        <span style={styles.projectIcon} aria-hidden="true">
          {projectIcon}
        </span>
        <h1 style={styles.title}>{projectName}</h1>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topBar: {
    height: "var(--topbar-height)",
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
    borderBottom: "1px solid var(--border)",
    gap: "8px",
    flexShrink: 0,
  },
  hamburger: {
    display: "none",
    flexShrink: 0,
    width: "32px",
    height: "32px",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  backButton: {
    display: "flex",
    flexShrink: 0,
    width: "32px",
    height: "32px",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  projectInfo: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  projectIcon: {
    fontSize: "1.125rem",
    flexShrink: 0,
    lineHeight: 1,
  },
  title: {
    flex: 1,
    fontSize: "0.9375rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
