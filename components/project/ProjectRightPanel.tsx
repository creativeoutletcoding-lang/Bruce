"use client";

import { useState } from "react";
import type { ProjectMemberDetail, File as BruceFile } from "@/lib/types";

function getMimeIcon(mimeType: string | null): string {
  if (!mimeType) return "📄";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "📊";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "📊";
  if (mimeType.includes("document") || mimeType.includes("word")) return "📝";
  if (mimeType.includes("pdf")) return "📋";
  if (mimeType.includes("image")) return "🖼️";
  if (mimeType.includes("folder")) return "📁";
  if (mimeType === "text/plain") return "📝";
  return "📄";
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CONNECTORS = [
  { name: "Google Drive", icon: "🗂️" },
  { name: "Google Calendar", icon: "📅" },
  { name: "QuickBooks", icon: "💼" },
  { name: "Precise Petcare", icon: "🐾" },
  { name: "Melio", icon: "💳" },
];

interface ProjectRightPanelProps {
  projectId: string;
  canEdit: boolean;
  // Instructions
  instructions: string;
  onInstructionsChange: (v: string) => void;
  onInstructionsSave: () => void;
  isSavingInstructions: boolean;
  // Files
  files: BruceFile[];
  onOpenFilePicker: () => void;
  onDetachFile: (fileId: string) => void;
  // Members
  members: ProjectMemberDetail[];
  userId: string;
  onOpenMemberPicker: () => void;
  onRemoveMember: (userId: string) => void;
}

function SectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div style={sectionStyles.header} onClick={onToggle}>
      <span style={sectionStyles.label}>{label}</span>
      <div style={sectionStyles.headerRight} onClick={(e) => e.stopPropagation()}>
        {action}
        <button style={sectionStyles.chevronBtn} onClick={onToggle} aria-label={open ? "Collapse" : "Expand"}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease" }}
            aria-hidden="true"
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function ProjectRightPanel({
  canEdit,
  instructions,
  onInstructionsChange,
  onInstructionsSave,
  isSavingInstructions,
  files,
  onOpenFilePicker,
  onDetachFile,
  members,
  userId,
  onOpenMemberPicker,
  onRemoveMember,
}: ProjectRightPanelProps) {
  const [open, setOpen] = useState({
    instructions: true,
    files: true,
    connectors: false,
    members: true,
  });

  function toggle(section: keyof typeof open) {
    setOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  return (
    <div style={styles.panel}>
      {/* Instructions */}
      <div style={styles.section}>
        <SectionHeader
          label="Instructions"
          open={open.instructions}
          onToggle={() => toggle("instructions")}
          action={
            isSavingInstructions ? (
              <span style={styles.savingText}>Saving…</span>
            ) : undefined
          }
        />
        {open.instructions && (
          <div style={styles.content}>
            {canEdit ? (
              <textarea
                value={instructions}
                onChange={(e) => onInstructionsChange(e.target.value)}
                onBlur={onInstructionsSave}
                placeholder="Describe how Bruce should behave in this project…"
                style={styles.textarea}
                rows={5}
              />
            ) : (
              <p style={styles.readonlyText}>
                {instructions || (
                  <span style={{ color: "var(--text-tertiary)" }}>No instructions set.</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Files */}
      <div style={styles.section}>
        <SectionHeader
          label="Files"
          open={open.files}
          onToggle={() => toggle("files")}
          action={
            canEdit ? (
              <button
                style={styles.actionLink}
                onClick={onOpenFilePicker}
              >
                Attach
              </button>
            ) : undefined
          }
        />
        {open.files && (
          <div style={styles.content}>
            {files.length === 0 ? (
              <p style={styles.empty}>No files attached.</p>
            ) : (
              <div style={styles.fileList}>
                {files.map((f) => (
                  <div key={f.id} style={styles.fileRow}>
                    <span style={styles.fileIcon}>{getMimeIcon(f.mime_type)}</span>
                    <div style={styles.fileInfo}>
                      {f.drive_url ? (
                        <a
                          href={f.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.fileLink}
                        >
                          {f.name}
                        </a>
                      ) : (
                        <span style={styles.fileName}>{f.name}</span>
                      )}
                      <span style={styles.fileMeta}>{formatRelativeTime(f.last_updated)}</span>
                    </div>
                    {canEdit && (
                      <button
                        style={styles.removeBtn}
                        onClick={() => onDetachFile(f.id)}
                        title={`Remove ${f.name}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Connectors */}
      <div style={styles.section}>
        <SectionHeader
          label="Connectors"
          open={open.connectors}
          onToggle={() => toggle("connectors")}
        />
        {open.connectors && (
          <div style={styles.content}>
            <div style={styles.connectorList}>
              {CONNECTORS.map((c) => (
                <div key={c.name} style={styles.connectorRow}>
                  <span style={styles.connectorIcon}>{c.icon}</span>
                  <span style={styles.connectorName}>{c.name}</span>
                  <span style={styles.notConnected}>Not connected</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Members */}
      <div style={styles.section}>
        <SectionHeader
          label="Members"
          open={open.members}
          onToggle={() => toggle("members")}
          action={
            canEdit ? (
              <button style={styles.actionLink} onClick={onOpenMemberPicker}>
                Add
              </button>
            ) : undefined
          }
        />
        {open.members && (
          <div style={styles.content}>
            <div style={styles.memberList}>
              {members.map((m) => (
                <div key={m.id} style={styles.memberRow}>
                  <div style={{ ...styles.memberAvatar, backgroundColor: m.color_hex }}>
                    {m.name[0].toUpperCase()}
                  </div>
                  <span style={styles.memberName}>{m.name}</span>
                  <span
                    style={{
                      ...styles.roleBadge,
                      ...(m.role === "owner" ? styles.roleBadgeOwner : {}),
                    }}
                  >
                    {m.role}
                  </span>
                  {canEdit && m.id !== userId && m.role !== "owner" && (
                    <button
                      style={styles.removeBtn}
                      onClick={() => onRemoveMember(m.id)}
                      title={`Remove ${m.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const sectionStyles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    cursor: "pointer",
    userSelect: "none",
    borderBottom: "0.5px solid var(--border)",
  },
  label: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--text-tertiary)",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  chevronBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    padding: "2px",
  },
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  section: {
    borderBottom: "0.5px solid var(--border)",
  },
  content: {
    padding: "12px 16px",
  },
  savingText: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
  },
  actionLink: {
    fontSize: "0.75rem",
    fontWeight: "500",
    color: "var(--accent)",
    cursor: "pointer",
    backgroundColor: "transparent",
    border: "none",
    padding: 0,
  },
  textarea: {
    width: "100%",
    resize: "vertical",
    fontSize: "0.8125rem",
    lineHeight: "1.6",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    fontFamily: "inherit",
    padding: "0",
    minHeight: "80px",
  },
  readonlyText: {
    fontSize: "0.8125rem",
    lineHeight: "1.6",
    color: "var(--text-primary)",
  },
  empty: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
  },

  // Files
  fileList: { display: "flex", flexDirection: "column", gap: "10px" },
  fileRow: { display: "flex", alignItems: "center", gap: "8px" },
  fileIcon: { fontSize: "1rem", flexShrink: 0 },
  fileInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    minWidth: 0,
    flex: 1,
  },
  fileLink: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--accent)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: "none",
  },
  fileName: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileMeta: { fontSize: "0.6875rem", color: "var(--text-tertiary)" },
  removeBtn: {
    fontSize: "1.125rem",
    lineHeight: 1,
    color: "var(--text-tertiary)",
    cursor: "pointer",
    padding: "2px 4px",
    flexShrink: 0,
  },

  // Connectors
  connectorList: { display: "flex", flexDirection: "column", gap: "8px" },
  connectorRow: { display: "flex", alignItems: "center", gap: "8px" },
  connectorIcon: { fontSize: "1rem", flexShrink: 0 },
  connectorName: {
    flex: 1,
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
  notConnected: {
    fontSize: "0.6875rem",
    fontWeight: "500",
    padding: "2px 7px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--bg-secondary)",
    border: "0.5px solid var(--border)",
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },

  // Members
  memberList: { display: "flex", flexDirection: "column", gap: "8px" },
  memberRow: { display: "flex", alignItems: "center", gap: "8px" },
  memberAvatar: {
    width: "24px",
    height: "24px",
    borderRadius: "var(--radius-full)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.625rem",
    fontWeight: "600",
    color: "#fff",
    flexShrink: 0,
  },
  memberName: {
    flex: 1,
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  roleBadge: {
    fontSize: "0.6875rem",
    fontWeight: "500",
    padding: "2px 7px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--bg-secondary)",
    border: "0.5px solid var(--border)",
    color: "var(--text-tertiary)",
    textTransform: "capitalize",
    flexShrink: 0,
  },
  roleBadgeOwner: {
    backgroundColor: "rgba(15, 110, 86, 0.08)",
    borderColor: "rgba(15, 110, 86, 0.2)",
    color: "var(--accent)",
  },
};
