"use client";

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
  // Memory
  isolateMemory: boolean;
  onIsolateMemoryChange: (v: boolean) => void;
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
  isolateMemory,
  onIsolateMemoryChange,
}: ProjectRightPanelProps) {
  return (
    <div style={styles.panel}>
      {/* Instructions */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionLabel}>Instructions</span>
          {isSavingInstructions && <span style={styles.savingText}>Saving…</span>}
        </div>
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
      </div>

      {/* Files */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionLabel}>Files</span>
          {canEdit && (
            <button style={styles.actionLink} onClick={onOpenFilePicker}>
              Attach
            </button>
          )}
        </div>
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
      </div>

      {/* Members */}
      <div style={styles.section}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionLabel}>Members</span>
          {canEdit && (
            <button style={styles.actionLink} onClick={onOpenMemberPicker}>
              Add
            </button>
          )}
        </div>
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
      </div>

      {/* Memory */}
      <div style={styles.section}>
        <div style={styles.memoryRow}>
          <div style={styles.memoryLabelGroup}>
            <span style={styles.sectionLabel}>Memory</span>
            <span style={styles.memorySubtitle}>Keep memories within this project</span>
          </div>
          <button
            role="switch"
            aria-checked={isolateMemory}
            onClick={() => canEdit && onIsolateMemoryChange(!isolateMemory)}
            style={{
              ...styles.toggleTrack,
              ...(isolateMemory ? styles.toggleTrackOn : {}),
              cursor: canEdit ? "pointer" : "default",
              opacity: canEdit ? 1 : 0.5,
            }}
          >
            <span
              style={{
                ...styles.toggleThumb,
                ...(isolateMemory ? styles.toggleThumbOn : {}),
              }}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
  },
  section: {
    borderBottom: "0.5px solid var(--border)",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    borderBottom: "0.5px solid var(--border)",
  },
  sectionLabel: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    color: "var(--text-tertiary)",
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

  // Memory
  memoryRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
    gap: "12px",
  },
  memoryLabelGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    flex: 1,
    minWidth: 0,
  },
  memorySubtitle: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    lineHeight: 1.4,
  },
  toggleTrack: {
    flexShrink: 0,
    position: "relative" as const,
    width: "36px",
    height: "20px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--border-strong)",
    border: "none",
    padding: 0,
    transition: "background-color 150ms ease",
  },
  toggleTrackOn: {
    backgroundColor: "var(--accent)",
  },
  toggleThumb: {
    position: "absolute" as const,
    top: "3px",
    left: "3px",
    width: "14px",
    height: "14px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "#fff",
    transition: "left 150ms ease",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  },
  toggleThumbOn: {
    left: "19px",
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
