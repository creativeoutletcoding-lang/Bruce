"use client";

import { useRouter } from "next/navigation";
import ChatTopBar from "@/components/chat/ChatTopBar";
import type { ProjectMemberDetail } from "@/lib/types";
import { getProfileColor } from "@/lib/chat/senderProfile";

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
    <ChatTopBar
      left={
        <button
          style={iconButton}
          onClick={() => router.push(`/projects/${projectId}`)}
          aria-label="Back to project"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M11 4L5 9l6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      }
      titleIcon={<span style={{ fontSize: "1.125rem", lineHeight: 1, flexShrink: 0 }}>{projectIcon}</span>}
      title={projectName}
      right={
        visibleAvatars.length > 0 ? (
          <div style={styles.avatarStack}>
            {visibleAvatars.map((m, i) => (
              <div
                key={m.id}
                title={m.name}
                style={{
                  ...styles.avatarPip,
                  backgroundColor: getProfileColor(m.id, m.color_hex),
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
        ) : undefined
      }
    />
  );
}

const iconButton: React.CSSProperties = {
  width: "32px",
  height: "32px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-secondary)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  flexShrink: 0,
};

const styles: Record<string, React.CSSProperties> = {
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
