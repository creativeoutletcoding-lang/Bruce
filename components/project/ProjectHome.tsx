"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProjectRightPanel from "./ProjectRightPanel";
import type {
  ProjectMemberDetail,
  File as BruceFile,
  ChatPreview,
  UserSummary,
  DriveFile,
} from "@/lib/types";

interface ProjectHomeProps {
  projectId: string;
  projectName: string;
  projectIcon: string;
  projectInstructions: string;
  projectOwnerId: string;
  members: ProjectMemberDetail[];
  files: BruceFile[];
  initialChats: ChatPreview[];
  userId: string;
  userRole: "owner" | "member";
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

export default function ProjectHome({
  projectId,
  projectName,
  projectIcon,
  projectInstructions,
  members,
  files: initialFiles,
  initialChats,
  userId,
  userRole,
}: ProjectHomeProps) {
  const router = useRouter();
  const supabase = createClient();
  const canEdit = userRole === "owner";

  // ── Instructions ──────────────────────────────────────────────
  const [instructions, setInstructions] = useState(projectInstructions);
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);

  // ── Files ─────────────────────────────────────────────────────
  const [fileList, setFileList] = useState<BruceFile[]>(initialFiles);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [filePickerTab, setFilePickerTab] = useState<"browse" | "upload">("browse");
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [isBrowseLoading, setIsBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadType, setUploadType] = useState<"doc" | "sheet" | "note">("note");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Members ───────────────────────────────────────────────────
  const [memberList, setMemberList] = useState<ProjectMemberDetail[]>(members);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const [isAddingMember, setIsAddingMember] = useState(false);

  // ── Chats ─────────────────────────────────────────────────────
  const [chats, setChats] = useState<ChatPreview[]>(initialChats);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [inlineInput, setInlineInput] = useState("");

  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);

  // ── Instructions ──────────────────────────────────────────────

  const saveInstructions = useCallback(
    async (value: string) => {
      if (value === projectInstructions) return;
      setIsSavingInstructions(true);
      try {
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instructions: value }),
        });
      } finally {
        setIsSavingInstructions(false);
      }
    },
    [projectId, projectInstructions]
  );

  // ── Files ─────────────────────────────────────────────────────

  async function refreshFiles() {
    const res = await fetch(`/api/projects/${projectId}/files`);
    if (res.ok) setFileList(await res.json());
  }

  async function openFilePicker(tab: "browse" | "upload") {
    setFilePickerTab(tab);
    setShowFilePicker(true);
    setBrowseError(null);
    setUploadError(null);
    if (tab === "browse") await loadDriveFiles();
  }

  async function loadDriveFiles() {
    setIsBrowseLoading(true);
    setBrowseError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/files/browse`);
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setBrowseError(data.error ?? "Could not load Drive files");
        return;
      }
      setDriveFiles(await res.json());
    } catch {
      setBrowseError("Could not reach Google Drive");
    } finally {
      setIsBrowseLoading(false);
    }
  }

  async function handleAttachDriveFile(driveFile: DriveFile) {
    setAttachingId(driveFile.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_drive_file_id: driveFile.id,
          name: driveFile.name,
          mime_type: driveFile.mimeType,
          drive_url: driveFile.webViewLink,
        }),
      });
      if (res.ok) { await refreshFiles(); setShowFilePicker(false); }
    } finally {
      setAttachingId(null);
    }
  }

  async function handleUploadAndAttach() {
    if (!uploadName.trim() || isUploading) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/files/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: uploadName.trim(), content: uploadContent, type: uploadType }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setUploadError(data.error ?? "Upload failed");
        return;
      }
      await refreshFiles();
      setUploadName(""); setUploadContent(""); setUploadType("note");
      setShowFilePicker(false);
    } catch {
      setUploadError("Upload failed. Check your Google Drive connection.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDetachFile(fileId: string) {
    const res = await fetch(`/api/projects/${projectId}/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (res.ok) setFileList((prev) => prev.filter((f) => f.id !== fileId));
  }

  // ── Members ───────────────────────────────────────────────────

  async function handleOpenMemberPicker() {
    setShowMemberPicker(true);
    if (allUsers.length === 0) {
      const res = await fetch("/api/users");
      if (res.ok) setAllUsers(await res.json());
    }
  }

  async function handleAddMember(targetUserId: string) {
    setIsAddingMember(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: targetUserId }),
      });
      if (res.ok) {
        const added = allUsers.find((u) => u.id === targetUserId);
        if (added) {
          setMemberList((prev) => [
            ...prev,
            { id: added.id, name: added.name, avatar_url: added.avatar_url, color_hex: added.color_hex, role: "member" },
          ]);
        }
        setShowMemberPicker(false);
      }
    } finally {
      setIsAddingMember(false);
    }
  }

  async function handleRemoveMember(targetUserId: string) {
    const res = await fetch(`/api/projects/${projectId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: targetUserId }),
    });
    if (res.ok) setMemberList((prev) => prev.filter((m) => m.id !== targetUserId));
  }

  // ── Chats ─────────────────────────────────────────────────────

  async function handleSendInlineMessage() {
    const text = inlineInput.trim();
    if (!text || isCreatingChat) return;
    setIsCreatingChat(true);
    try {
      const { data: chat, error } = await supabase
        .from("chats")
        .insert({
          owner_id: userId,
          project_id: projectId,
          type: "private",
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (error || !chat) return;
      router.push(`/projects/${projectId}/chat/${chat.id}?q=${encodeURIComponent(text)}`);
    } finally {
      setIsCreatingChat(false);
    }
  }

  // ── Context menu ──────────────────────────────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    function dismiss() { setContextMenu(null); }
    document.addEventListener("click", dismiss);
    return () => document.removeEventListener("click", dismiss);
  }, [contextMenu]);

  function handleChatRightClick(e: React.MouseEvent, chatId: string, ownerId: string) {
    if (ownerId !== userId) return;
    e.preventDefault();
    setContextMenu({ id: chatId, x: e.clientX, y: e.clientY });
  }

  function handleChatLongPressStart(e: React.TouchEvent, chatId: string, ownerId: string) {
    if (ownerId !== userId) return;
    longPressActiveRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressActiveRef.current = true;
      const touch = e.touches[0];
      setContextMenu({ id: chatId, x: touch.clientX, y: touch.clientY });
    }, 500);
  }

  function handleChatLongPressEnd(e: React.TouchEvent) {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    if (longPressActiveRef.current) e.preventDefault();
  }

  function handleChatLongPressMove() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  }

  async function handleDeleteChat() {
    if (!deleteTargetId || isDeletingChat) return;
    setIsDeletingChat(true);
    try {
      const res = await fetch("/api/chats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [deleteTargetId] }),
      });
      if (res.ok) {
        setChats((prev) => prev.filter((c) => c.id !== deleteTargetId));
      }
    } finally {
      setIsDeletingChat(false);
      setDeleteTargetId(null);
    }
  }

  // ── Computed ──────────────────────────────────────────────────

  const visibleMemberAvatars = memberList.slice(0, 4);
  const attachedDriveIds = new Set(fileList.map((f) => f.google_drive_file_id));
  const nonMembers = allUsers.filter((u) => !memberList.some((m) => m.id === u.id));

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      <div className="ph-body">
        {/* Left column */}
        <div className="ph-left">
          <div style={styles.leftInner}>
            {/* Project header */}
            <div style={styles.header}>
              <span style={styles.projectIcon}>{projectIcon}</span>
              <h1 style={styles.projectName}>{projectName}</h1>
              <div style={styles.memberAvatars}>
                {visibleMemberAvatars.map((m, i) => (
                  <div
                    key={m.id}
                    style={{
                      ...styles.memberAvatar,
                      backgroundColor: m.color_hex,
                      zIndex: 10 - i,
                      marginLeft: i > 0 ? "-8px" : "0",
                    }}
                    title={m.name}
                  >
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                ))}
                {memberList.length > 4 && (
                  <div
                    style={{
                      ...styles.memberAvatar,
                      ...styles.memberAvatarMore,
                      marginLeft: "-8px",
                      zIndex: 6,
                    }}
                  >
                    +{memberList.length - 4}
                  </div>
                )}
              </div>
            </div>

            {/* New chat input */}
            <div style={styles.newChatBox}>
              <textarea
                value={inlineInput}
                onChange={(e) => setInlineInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendInlineMessage();
                  }
                }}
                placeholder={`Start a conversation about ${projectName}…`}
                style={styles.newChatTextarea}
                rows={2}
                disabled={isCreatingChat}
              />
              <button
                style={{
                  ...styles.newChatSend,
                  ...(!inlineInput.trim() || isCreatingChat ? styles.newChatSendDisabled : {}),
                }}
                onClick={handleSendInlineMessage}
                disabled={!inlineInput.trim() || isCreatingChat}
              >
                {isCreatingChat ? "…" : "↑"}
              </button>
            </div>

            {/* Chats list */}
            <div style={styles.chatsSection}>
              <span style={styles.sectionLabel}>Chats</span>
              {chats.length === 0 ? (
                <p style={styles.emptyState}>No conversations yet.</p>
              ) : (
                <div style={styles.chatList}>
                  {chats.map((chat) => (
                    <button
                      key={chat.id}
                      style={styles.chatRow}
                      onClick={() => {
                        if (longPressActiveRef.current) { longPressActiveRef.current = false; return; }
                        router.push(`/projects/${projectId}/chat/${chat.id}`);
                      }}
                      onContextMenu={(e) => handleChatRightClick(e, chat.id, chat.owner_id)}
                      onTouchStart={(e) => handleChatLongPressStart(e, chat.id, chat.owner_id)}
                      onTouchEnd={handleChatLongPressEnd}
                      onTouchMove={handleChatLongPressMove}
                    >
                      <div style={styles.chatRowTop}>
                        <span style={styles.chatTitle}>
                          {chat.title ?? "New conversation"}
                        </span>
                        <span style={styles.chatTime}>
                          {formatRelativeTime(chat.last_message_at)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column — in-flow on desktop, stacked below on mobile */}
        <div className="ph-right">
          <ProjectRightPanel
            projectId={projectId}
            canEdit={canEdit}
            instructions={instructions}
            onInstructionsChange={setInstructions}
            onInstructionsSave={() => saveInstructions(instructions)}
            isSavingInstructions={isSavingInstructions}
            files={fileList}
            onOpenFilePicker={() => openFilePicker("browse")}
            onDetachFile={handleDetachFile}
            members={memberList}
            userId={userId}
            onOpenMemberPicker={handleOpenMemberPicker}
            onRemoveMember={handleRemoveMember}
          />
        </div>
      </div>

      {/* Chat context menu */}
      {contextMenu && (
        <div
          style={{ ...styles.contextMenu, top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            style={styles.contextMenuItem}
            onClick={() => {
              setDeleteTargetId(contextMenu.id);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTargetId && (
        <div style={styles.modalOverlay} onClick={() => setDeleteTargetId(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Delete this chat?</span>
              <button style={styles.modalClose} onClick={() => setDeleteTargetId(null)}>×</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "20px" }}>
                This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  style={styles.cancelButton}
                  onClick={() => setDeleteTargetId(null)}
                  disabled={isDeletingChat}
                >
                  Cancel
                </button>
                <button
                  style={{ ...styles.deleteConfirmButton, ...(isDeletingChat ? { opacity: 0.6 } : {}) }}
                  onClick={handleDeleteChat}
                  disabled={isDeletingChat}
                >
                  {isDeletingChat ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File picker modal */}
      {showFilePicker && (
        <div style={styles.modalOverlay} onClick={() => setShowFilePicker(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Attach file</span>
              <button style={styles.modalClose} onClick={() => setShowFilePicker(false)}>×</button>
            </div>
            <div style={styles.tabs}>
              {(["browse", "upload"] as const).map((t) => (
                <button
                  key={t}
                  style={{ ...styles.tab, ...(filePickerTab === t ? styles.tabActive : {}) }}
                  onClick={async () => {
                    setFilePickerTab(t);
                    if (t === "browse" && driveFiles.length === 0 && !isBrowseLoading) await loadDriveFiles();
                  }}
                >
                  {t === "browse" ? "Browse Drive" : "Upload new"}
                </button>
              ))}
            </div>
            {filePickerTab === "browse" && (
              <div style={styles.tabContent}>
                {isBrowseLoading ? (
                  <p style={styles.tabEmpty}>Loading Drive files…</p>
                ) : browseError ? (
                  <div>
                    <p style={styles.errorText}>{browseError}</p>
                    <button style={styles.retryLink} onClick={loadDriveFiles}>Try again</button>
                  </div>
                ) : driveFiles.length === 0 ? (
                  <p style={styles.tabEmpty}>No files in your Bruce Drive folder.</p>
                ) : (
                  <div style={styles.fileList}>
                    {driveFiles.map((f) => {
                      const attached = attachedDriveIds.has(f.id);
                      return (
                        <div key={f.id} style={styles.fileRow}>
                          <span style={styles.fileIcon}>{getMimeIcon(f.mimeType)}</span>
                          <div style={styles.fileInfo}>
                            <span style={styles.driveFileName}>{f.name}</span>
                            <span style={styles.fileMeta}>{formatRelativeTime(f.modifiedTime)}</span>
                          </div>
                          {attached ? (
                            <span style={styles.attachedBadge}>Attached</span>
                          ) : (
                            <button
                              style={styles.attachButton}
                              onClick={() => handleAttachDriveFile(f)}
                              disabled={attachingId === f.id}
                            >
                              {attachingId === f.id ? "…" : "Attach"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {filePickerTab === "upload" && (
              <div style={styles.tabContent}>
                <div style={styles.uploadForm}>
                  <div style={styles.typeRow}>
                    {(["note", "doc", "sheet"] as const).map((t) => (
                      <button
                        key={t}
                        style={{ ...styles.typeOption, ...(uploadType === t ? styles.typeOptionSelected : {}) }}
                        onClick={() => setUploadType(t)}
                      >
                        {t === "note" ? "📝 Note" : t === "doc" ? "📄 Doc" : "📊 Sheet"}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    placeholder="File name"
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    style={styles.uploadInput}
                  />
                  <textarea
                    placeholder={uploadType === "sheet" ? "CSV content" : "Content (optional)"}
                    value={uploadContent}
                    onChange={(e) => setUploadContent(e.target.value)}
                    style={styles.uploadTextarea}
                    rows={5}
                  />
                  {uploadError && <p style={styles.errorText}>{uploadError}</p>}
                  <button
                    style={{ ...styles.createButton, ...(!uploadName.trim() || isUploading ? styles.createButtonDisabled : {}) }}
                    onClick={handleUploadAndAttach}
                    disabled={!uploadName.trim() || isUploading}
                  >
                    {isUploading ? "Creating…" : "Create and attach"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Member picker modal */}
      {showMemberPicker && (
        <div style={styles.modalOverlay} onClick={() => setShowMemberPicker(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Add member</span>
              <button style={styles.modalClose} onClick={() => setShowMemberPicker(false)}>×</button>
            </div>
            {nonMembers.length === 0 ? (
              <p style={{ fontSize: "0.875rem", color: "var(--text-tertiary)", padding: "20px" }}>
                All household members are already in this project.
              </p>
            ) : (
              <div style={styles.tabContent}>
                {nonMembers.map((u) => (
                  <button
                    key={u.id}
                    style={styles.userPickerRow}
                    onClick={() => handleAddMember(u.id)}
                    disabled={isAddingMember}
                  >
                    <div style={{ ...styles.userPickerAvatar, backgroundColor: u.color_hex }}>
                      {u.name[0].toUpperCase()}
                    </div>
                    <span style={styles.userPickerName}>{u.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    backgroundColor: "var(--bg-primary)",
  },

  // Left column inner scroll content
  leftInner: {
    padding: "40px 32px 48px",
    maxWidth: "640px",
    width: "100%",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "28px",
  },

  // Project header
  header: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    flexWrap: "wrap" as const,
  },
  projectIcon: {
    fontSize: "2.5rem",
    lineHeight: 1,
    flexShrink: 0,
  },
  projectName: {
    fontSize: "1.625rem",
    fontWeight: "700",
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
    flex: 1,
    minWidth: 0,
  },
  memberAvatars: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  memberAvatar: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    border: "2px solid var(--bg-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.6875rem",
    fontWeight: "600",
    color: "#fff",
    flexShrink: 0,
  },
  memberAvatarMore: {
    backgroundColor: "var(--bg-secondary)",
    border: "2px solid var(--border)",
    fontSize: "0.625rem",
    fontWeight: "600",
    color: "var(--text-secondary)",
  },

  // New chat input
  newChatBox: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    backgroundColor: "var(--bg-secondary)",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "12px 14px",
  },
  newChatTextarea: {
    flex: 1,
    resize: "none" as const,
    fontSize: "0.9375rem",
    lineHeight: "1.5",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    fontFamily: "inherit",
    padding: "0",
    maxHeight: "120px",
    overflowY: "auto" as const,
  },
  newChatSend: {
    width: "32px",
    height: "32px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--accent)",
    color: "#fff",
    fontSize: "1.125rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    transition: "opacity var(--transition)",
  },
  newChatSendDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },

  // Chats section
  chatsSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  sectionLabel: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--text-tertiary)",
  },
  emptyState: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    padding: "8px 0",
  },
  chatList: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  chatRow: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    textAlign: "left",
    cursor: "pointer",
    backgroundColor: "transparent",
    transition: "background-color var(--transition)",
    border: "none",
  },
  chatRowTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  chatTitle: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatTime: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },

  // Modals
  modalOverlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    zIndex: 300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  modal: {
    backgroundColor: "var(--bg-primary)",
    borderRadius: "var(--radius-lg)",
    border: "0.5px solid var(--border)",
    width: "100%",
    maxWidth: "420px",
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    maxHeight: "80vh",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "0.5px solid var(--border)",
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
  },
  modalClose: {
    fontSize: "1.25rem",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    lineHeight: 1,
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
  },
  tabs: {
    display: "flex",
    borderBottom: "0.5px solid var(--border)",
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: "10px 16px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-secondary)",
    cursor: "pointer",
    backgroundColor: "transparent",
    borderBottom: "2px solid transparent",
    transition: "color var(--transition), border-color var(--transition)",
  },
  tabActive: {
    color: "var(--accent)",
    borderBottom: "2px solid var(--accent)",
  },
  tabContent: {
    overflowY: "auto",
    padding: "12px",
    flex: 1,
  },
  tabEmpty: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    textAlign: "center",
    padding: "12px 8px",
  },
  fileList: { display: "flex", flexDirection: "column", gap: "4px" },
  fileRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
  },
  fileIcon: { fontSize: "1.125rem", flexShrink: 0 },
  fileInfo: { flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  driveFileName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileMeta: { fontSize: "0.75rem", color: "var(--text-tertiary)" },
  attachButton: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    padding: "4px 10px",
    backgroundColor: "var(--accent)",
    color: "#fff",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    flexShrink: 0,
  },
  attachedBadge: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    padding: "4px 8px",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    flexShrink: 0,
  },
  errorText: { fontSize: "0.8125rem", color: "#dc2626" },
  retryLink: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--accent)",
    cursor: "pointer",
    marginTop: "8px",
  },
  uploadForm: { display: "flex", flexDirection: "column", gap: "12px" },
  typeRow: { display: "flex", gap: "8px" },
  typeOption: {
    flex: 1,
    padding: "8px 4px",
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "var(--radius-md)",
    border: "0.5px solid var(--border)",
    cursor: "pointer",
  },
  typeOptionSelected: {
    color: "var(--accent)",
    borderColor: "var(--accent)",
    backgroundColor: "rgba(15,110,86,0.06)",
  },
  uploadInput: {
    width: "100%",
    padding: "9px 12px",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    fontFamily: "inherit",
  },
  uploadTextarea: {
    width: "100%",
    padding: "9px 12px",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    fontFamily: "inherit",
    resize: "vertical" as const,
  },
  createButton: {
    width: "100%",
    padding: "10px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#fff",
    backgroundColor: "var(--accent)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  },
  createButtonDisabled: { opacity: 0.5, cursor: "not-allowed" },
  contextMenu: {
    position: "fixed" as const,
    zIndex: 500,
    backgroundColor: "var(--bg-primary)",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
    overflow: "hidden",
    minWidth: "140px",
  },
  contextMenuItem: {
    display: "block",
    width: "100%",
    padding: "10px 16px",
    textAlign: "left" as const,
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#dc2626",
    cursor: "pointer",
    backgroundColor: "transparent",
  },
  cancelButton: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-secondary)",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  },
  deleteConfirmButton: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#fff",
    backgroundColor: "#dc2626",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
  },
  userPickerRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    textAlign: "left",
    backgroundColor: "transparent",
    border: "none",
  },
  userPickerAvatar: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.6875rem",
    fontWeight: "500",
    color: "#fff",
    flexShrink: 0,
  },
  userPickerName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
};
