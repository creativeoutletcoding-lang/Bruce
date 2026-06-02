"use client";

import type { MovableProject, MovableProjectMember } from "@/lib/types";
import { getProfileColor } from "@/lib/chat/senderProfile";

interface ProjectPickerListProps {
  projects: MovableProject[];
  onSelect: (projectId: string) => void;
  loading?: boolean;
}

// Shared list of projects (icon + name + member pips) used by both the desktop
// flyout and the mobile second-level sheet of the "Move to project" menu.
export default function ProjectPickerList({ projects, onSelect, loading }: ProjectPickerListProps) {
  if (loading) {
    return <div style={styles.message}>Loading projects…</div>;
  }
  if (projects.length === 0) {
    return <div style={styles.message}>No projects available</div>;
  }
  return (
    <div style={styles.list} role="menu">
      {projects.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          style={styles.row}
          onClick={() => onSelect(p.id)}
        >
          <span style={styles.icon} aria-hidden="true">{p.icon || "📁"}</span>
          <span style={styles.name}>{p.name}</span>
          <PipStack members={p.members} />
        </button>
      ))}
    </div>
  );
}

function PipStack({ members }: { members: MovableProjectMember[] }) {
  const shown = members.slice(0, 4);
  const overflow = members.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <div style={styles.pipStack}>
      {shown.map((m, i) => (
        <div
          key={m.id}
          title={m.name}
          style={{
            ...styles.pip,
            backgroundColor: getProfileColor(m.id, m.color_hex),
            marginLeft: i > 0 ? "-6px" : 0,
            zIndex: 10 - i,
          }}
        >
          {m.name[0]?.toUpperCase() ?? "?"}
        </div>
      ))}
      {overflow > 0 && (
        <div style={{ ...styles.pip, ...styles.pipMore, marginLeft: "-6px", zIndex: 5 }}>
          +{overflow}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  list: {
    display: "flex",
    flexDirection: "column",
  },
  message: {
    padding: "12px 14px",
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "10px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  },
  icon: {
    fontSize: "1rem",
    lineHeight: 1,
    flexShrink: 0,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: "0.875rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  pipStack: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  pip: {
    width: "22px",
    height: "22px",
    borderRadius: "var(--radius-full)",
    border: "1.5px solid var(--bg-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.5625rem",
    fontWeight: 600,
    color: "#fff",
    flexShrink: 0,
  },
  pipMore: {
    backgroundColor: "var(--bg-secondary)",
    border: "1.5px solid var(--border)",
    color: "var(--text-tertiary)",
  },
};
