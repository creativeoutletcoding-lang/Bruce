"use client";

import { useRouter } from "next/navigation";
import type { ProjectMemberDetail } from "@/lib/types";

interface ProjectTopBarProps {
  projectId: string;
  projectName: string;
  projectIcon: string;
  members: ProjectMemberDetail[];
}

export default function ProjectTopBar({
  projectId,
  projectName,
  projectIcon,
  members,
}: ProjectTopBarProps) {
  const router = useRouter();
  const visibleAvatars = members.slice(0, 4);

  return (
    <div style={styles.topBar}>
      <button
        style={styles.backButton}
        onClick={() => router.push(`/projects/${projectId}`)}
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

      {visibleAvatars.length > 0 && (
        <div style={styles.avatarStack}>
          {visibleAvatars.map((m, i) => (
            <div
              key={m.id}
              title={m.name}
              style={{
                ...styles.avatarPip,
                backgroundColor: m.color_hex,
                marginLeft: i > 0 ? "-6px" : "0",
                zIndex: 10 - i,
              }}
            >
              {m.name[0].toUpperCase()}
            </div>
          ))}
          {members.length > 4 && (
            <div
              style={{
                ...styles.avatarPip,
                ...styles.avatarMore,
                marginLeft: "-6px",
                zIndex: 6,
              }}
            >
              +{members.length - 4}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topBar: {
    height: "var(--topbar-height)",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    gap: "8px",
    flexShrink: 0,
    borderBottom: "0.5px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
  },
  backButton: {
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    flexShrink: 0,
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
    lineHeight: 1,
    flexShrink: 0,
  },
  title: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  avatarStack: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  avatarPip: {
    width: "24px",
    height: "24px",
    borderRadius: "var(--radius-full)",
    border: "1.5px solid var(--bg-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.625rem",
    fontWeight: "600",
    color: "#fff",
    flexShrink: 0,
  },
  avatarMore: {
    backgroundColor: "var(--bg-secondary)",
    border: "1.5px solid var(--border)",
    color: "var(--text-tertiary)",
    fontSize: "0.5625rem",
  },
};
