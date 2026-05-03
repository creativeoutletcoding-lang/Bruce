"use client";

import { useRouter } from "next/navigation";
import ModelPicker from "@/components/ui/ModelPicker";
import type { ProjectMemberDetail } from "@/lib/types";

interface ProjectTopBarProps {
  projectId: string;
  projectName: string;
  projectIcon: string;
  members: ProjectMemberDetail[];
  model?: string;
  onModelChange?: (id: string) => void;
  onNewChat: () => void;
  onTogglePanel: () => void;
}

export default function ProjectTopBar({
  projectName,
  projectIcon,
  members,
  model,
  onModelChange,
  onNewChat,
  onTogglePanel,
}: ProjectTopBarProps) {
  const router = useRouter();
  const visibleAvatars = members.slice(0, 4);

  return (
    <div style={styles.topBar}>
      {/* Mobile: back arrow */}
      <button
        className="mobile-only"
        style={styles.iconButton}
        onClick={() => router.back()}
        aria-label="Back"
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

      {/* Project identity */}
      <div style={styles.projectInfo}>
        <span style={styles.projectIcon} aria-hidden="true">
          {projectIcon}
        </span>
        <h1 style={styles.title}>{projectName}</h1>
      </div>

      {/* Desktop: member avatar pips */}
      {visibleAvatars.length > 0 && (
        <div className="desktop-only" style={styles.avatarStack}>
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

      {/* Desktop: model picker */}
      {model && onModelChange && (
        <span className="desktop-only">
          <ModelPicker currentModel={model} onSelect={onModelChange} />
        </span>
      )}

      {/* Desktop: New chat button */}
      <button className="desktop-only" style={styles.newChatButton} onClick={onNewChat}>
        New chat
      </button>

      {/* Mobile: right icon buttons */}
      <div className="mobile-only" style={styles.mobileRight}>
        <button style={styles.iconButton} onClick={onTogglePanel} aria-label="Project details">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <rect x="2.5" y="2.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <line x1="11.5" y1="2.5" x2="11.5" y2="15.5" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </button>
        <button style={styles.iconButton} onClick={onNewChat} aria-label="New chat">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M9 3.5v11M3.5 9h11"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
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
  iconButton: {
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
  avatarStack: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    marginRight: "4px",
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
  newChatButton: {
    height: "30px",
    padding: "0 12px",
    backgroundColor: "var(--accent)",
    color: "#fff",
    borderRadius: "var(--radius-md)",
    fontSize: "0.8125rem",
    fontWeight: "500",
    cursor: "pointer",
    flexShrink: 0,
    whiteSpace: "nowrap",
    transition: "background-color var(--transition)",
  },
  mobileRight: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    flexShrink: 0,
  },
};
