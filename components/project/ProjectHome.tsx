"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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

const CONNECTORS = [
  { name: "Google Drive", icon: "🗂️" },
  { name: "Google Calendar", icon: "📅" },
  { name: "QuickBooks", icon: "💼" },
  { name: "Precise Petcare", icon: "🐾" },
  { name: "Melio", icon: "💳" },
];

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
  const pathname = usePathname();
  const supabase = createClient();
  const canEdit = userRole === "owner";

  // ── Instructions ───────────────────────────────────────────
  const [instructions, setInstructions] = useState(projectInstructions);
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);
  const instructionsSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Files ──────────────────────────────────────────────────
  const [fileList, setFileList] = useState<BruceFile[]>(initialFiles);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [filePickerTab, setFilePickerTab] = useState<"browse" | "upload">("browse");

  // Browse Drive tab
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [isBrowseLoading, setIsBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  // Upload new tab
  const [uploadName, setUploadName] = useState("");
  const [uploadContent, setUploadContent] = useState("");
  const [uploadType, setUploadType] = useState<"doc" | "sheet" | "note">("note");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Members ────────────────────────────────────────────────
  const [memberList, setMemberList] = useState<ProjectMemberDetail[]>(members);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const [isAddingMember, setIsAddingMember] = useState(false);

  // ── Chats ──────────────────────────────────────────────────
  const [chats, setChats] = useState<ChatPreview[]>(initialChats);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [inlineInput, setInlineInput] = useState("");

  // Context menu + single delete
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);

  // ── Helpers ────────────────────────────────────────────────

  async function refreshFiles() {
    const res = await fetch(`/api/projects/${projectId}/files`);
    if (res.ok) {
      const data: BruceFile[] = await res.json();
      setFileList(data);
    }
  }

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

  function handleInstructionsBlur() {
    if (instructionsSaveRef.current) clearTimeout(instructionsSaveRef.current);
    saveInstructions(instructions);
  }

  // ── File picker ────────────────────────────────────────────

  async function openFilePicker(tab: "browse" | "upload") {
    setFilePickerTab(tab);
    setShowFilePicker(true);
    setBrowseError(null);
    setUploadError(null);
    if (tab === "browse") {
      await loadDriveFiles();
    }
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
      const data: DriveFile[] = await res.json();
      setDriveFiles(data);
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
      if (res.ok) {
        await refreshFiles();
        setShowFilePicker(false);
      }
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
        body: JSON.stringify({
          name: uploadName.trim(),
          content: uploadContent,
          type: uploadType,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setUploadError(data.error ?? "Upload failed");
        return;
      }
      await refreshFiles();
      setUploadName("");
      setUploadContent("");
      setUploadType("note");
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
    if (res.ok) {
      setFileList((prev) => prev.filter((f) => f.id !== fileId));
    }
  }

  // ── Members ────────────────────────────────────────────────

  async function handleOpenMemberPicker() {
    setShowMemberPicker(true);
    if (allUsers.length === 0) {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data: UserSummary[] = await res.json();
        setAllUsers(data);
      }
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
    if (res.ok) {
      setMemberList((prev) => prev.filter((m) => m.id !== targetUserId));
    }
  }

  // ── Chats ──────────────────────────────────────────────────

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

      if (error || !chat) {
        console.error("[ProjectHome] Failed to create chat:", error);
        return;
      }
      router.push(`/projects/${projectId}/chat/${chat.id}?q=${encodeURIComponent(text)}`);
    } finally {
      setIsCreatingChat(false);
    }
  }

  // ── Chat context menu ──────────────────────────────────────

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
        const activeChatPath = `/projects/${projectId}/chat/${deleteTargetId}`;
        if (pathname === activeChatPath || pathname.startsWith(activeChatPath + "/")) {
          router.push(`/projects/${projectId}`);
        }
      }
    } finally {
      setIsDeletingChat(false);
      setDeleteTargetId(null);
    }
  }

  // ── Computed ───────────────────────────────────────────────

  const nonMembers = allUsers.filter(
    (u) => !memberList.some((m) => m.id === u.id)
  );

  const visibleMemberAvatars = memberList.slice(0, 4);

  // Already attached Drive file IDs (to show "Attached" state in browse)
  const attachedDriveIds = new Set(fileList.map((f) => f.google_drive_file_id));

  return (
    <div style={styles.page}>
      <div style={styles.scroll}>
        {/* HEADER */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={styles.projectIcon}>{projectIcon}</span>
            <h1 style={styles.projectName}>{projectName}</h1>
          </div>
          <div style={styles.memberAvatars}>
            {visibleMemberAvatars.map((m, i) => {
              console.log('avatar rendering, color_hex:', m.color_hex);
              return (
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
                  {m.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.avatar_url}
                      alt=""
                      style={styles.memberAvatarImg}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span style={styles.memberAvatarFallback}>
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
              );
            })}
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

        {/* INSTRUCTIONS */}
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Instructions</span>
            {isSavingInstructions && (
              <span style={styles.savingIndicator}>Saving…</span>
            )}
          </div>
          {canEdit ? (
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              onBlur={handleInstructionsBlur}
              placeholder="Describe how Bruce should behave in this project…"
              style={styles.instructionsTextarea}
              rows={4}
            />
          ) : (
            <p style={styles.instructionsReadonly}>
              {instructions || (
                <span style={{ color: "var(--text-tertiary)" }}>
                  No instructions set.
                </span>
              )}
            </p>
          )}
        </section>

        {/* FILES */}
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Files</span>
            {canEdit && (
              <button
                style={styles.panelAction}
                onClick={() => openFilePicker("browse")}
              >
                Attach file
              </button>
            )}
          </div>
          {fileList.length === 0 ? (
            <p style={styles.emptyState}>No files attached yet.</p>
          ) : (
            <div style={styles.fileList}>
              {fileList.map((f) => (
                <div key={f.id} style={styles.fileRow}>
                  <span style={styles.fileIcon}>{getMimeIcon(f.mime_type)}</span>
                  <div style={styles.fileInfo}>
                    {f.drive_url ? (
                      <a
                        href={f.drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.fileNameLink}
                      >
                        {f.name}
                      </a>
                    ) : (
                      <span style={styles.fileName}>{f.name}</span>
                    )}
                    <span style={styles.fileMeta}>
                      {formatRelativeTime(f.last_updated)}
                    </span>
                  </div>
                  {canEdit && (
                    <button
                      style={styles.removeButton}
                      onClick={() => handleDetachFile(f.id)}
                      title={`Remove ${f.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* MEMBERS */}
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Members</span>
            {canEdit && (
              <button style={styles.panelAction} onClick={handleOpenMemberPicker}>
                Add member
              </button>
            )}
          </div>
          <div style={styles.memberList}>
            {memberList.map((m) => {
              console.log('avatar rendering, color_hex:', m.color_hex);
              return (
              <div key={m.id} style={styles.memberRow}>
                <div style={{ ...styles.memberAvatarSmall, backgroundColor: m.color_hex }}>
                  {m.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.avatar_url}
                      alt=""
                      style={styles.memberAvatarSmallImg}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span style={styles.memberAvatarSmallFallback}>
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                  )}
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
                    style={styles.removeButton}
                    onClick={() => handleRemoveMember(m.id)}
                    title={`Remove ${m.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
              ); })}
          </div>
        </section>

        {/* CONNECTORS */}
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Connectors</span>
          </div>
          <div style={styles.connectorList}>
            {CONNECTORS.map((c) => (
              <div key={c.name} style={styles.connectorRow}>
                <span style={styles.connectorIcon}>{c.icon}</span>
                <span style={styles.connectorName}>{c.name}</span>
                <span style={styles.notConnectedBadge}>Not connected</span>
              </div>
            ))}
          </div>
        </section>

        {/* CHATS */}
        <section style={{ ...styles.panel, marginBottom: "40px" }}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Chats</span>
          </div>
          {chats.length === 0 ? (
            <p style={styles.emptyState}>
              No conversations yet. Type a message below to start one.
            </p>
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
                  {chat.last_message_content && (
                    <span style={styles.chatPreview}>
                      {chat.last_message_content.substring(0, 80)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* INLINE CHAT INPUT */}
      <div style={styles.inlineInputBar}>
        <div style={styles.inlineInputWrapper}>
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
            style={styles.inlineTextarea}
            rows={1}
            disabled={isCreatingChat}
          />
          <button
            style={{
              ...styles.inlineSendButton,
              ...((!inlineInput.trim() || isCreatingChat) ? styles.inlineSendButtonDisabled : {}),
            }}
            onClick={handleSendInlineMessage}
            disabled={!inlineInput.trim() || isCreatingChat}
          >
            {isCreatingChat ? "…" : "↑"}
          </button>
        </div>
      </div>

      {/* CHAT CONTEXT MENU */}
      {contextMenu && (
        <div
          style={{
            ...styles.contextMenu,
            top: contextMenu.y,
            left: contextMenu.x,
          }}
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

      {/* SINGLE DELETE CONFIRMATION */}
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

      {/* FILE PICKER MODAL */}
      {showFilePicker && (
        <div
          style={styles.modalOverlay}
          onClick={() => setShowFilePicker(false)}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Attach file</span>
              <button
                style={styles.modalClose}
                onClick={() => setShowFilePicker(false)}
              >
                ×
              </button>
            </div>

            {/* Tabs */}
            <div style={styles.tabs}>
              <button
                style={{
                  ...styles.tab,
                  ...(filePickerTab === "browse" ? styles.tabActive : {}),
                }}
                onClick={async () => {
                  setFilePickerTab("browse");
                  if (driveFiles.length === 0 && !isBrowseLoading) {
                    await loadDriveFiles();
                  }
                }}
              >
                Browse Drive
              </button>
              <button
                style={{
                  ...styles.tab,
                  ...(filePickerTab === "upload" ? styles.tabActive : {}),
                }}
                onClick={() => setFilePickerTab("upload")}
              >
                Upload new
              </button>
            </div>

            {/* Browse Drive tab */}
            {filePickerTab === "browse" && (
              <div style={styles.tabContent}>
                {isBrowseLoading ? (
                  <p style={styles.tabEmptyState}>Loading Drive files…</p>
                ) : browseError ? (
                  <div style={styles.errorBox}>
                    <p style={styles.errorText}>{browseError}</p>
                    <button style={styles.retryLink} onClick={loadDriveFiles}>
                      Try again
                    </button>
                  </div>
                ) : driveFiles.length === 0 ? (
                  <p style={styles.tabEmptyState}>
                    No files in your Bruce Drive folder for this project. Upload
                    one to get started.
                  </p>
                ) : (
                  <div style={styles.driveFileList}>
                    {driveFiles.map((f) => {
                      const alreadyAttached = attachedDriveIds.has(f.id);
                      return (
                        <div key={f.id} style={styles.driveFileRow}>
                          <span style={styles.fileIcon}>
                            {getMimeIcon(f.mimeType)}
                          </span>
                          <div style={styles.driveFileInfo}>
                            <span style={styles.driveFileName}>{f.name}</span>
                            <span style={styles.fileMeta}>
                              {formatRelativeTime(f.modifiedTime)}
                            </span>
                          </div>
                          {alreadyAttached ? (
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

            {/* Upload new tab */}
            {filePickerTab === "upload" && (
              <div style={styles.tabContent}>
                <div style={styles.uploadForm}>
                  {/* File type */}
                  <div style={styles.typeRow}>
                    {(["note", "doc", "sheet"] as const).map((t) => (
                      <button
                        key={t}
                        style={{
                          ...styles.typeOption,
                          ...(uploadType === t ? styles.typeOptionSelected : {}),
                        }}
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
                    placeholder={
                      uploadType === "sheet"
                        ? "CSV content (comma-separated)"
                        : "Content (optional)"
                    }
                    value={uploadContent}
                    onChange={(e) => setUploadContent(e.target.value)}
                    style={styles.uploadTextarea}
                    rows={5}
                  />

                  {uploadError && (
                    <p style={styles.errorText}>{uploadError}</p>
                  )}

                  <button
                    style={{
                      ...styles.createButton,
                      ...(!uploadName.trim() || isUploading
                        ? styles.createButtonDisabled
                        : {}),
                    }}
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

      {/* MEMBER PICKER MODAL */}
      {showMemberPicker && (
        <div
          style={styles.modalOverlay}
          onClick={() => setShowMemberPicker(false)}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Add member</span>
              <button
                style={styles.modalClose}
                onClick={() => setShowMemberPicker(false)}
              >
                ×
              </button>
            </div>
            {nonMembers.length === 0 ? (
              <p style={styles.tabEmptyState}>
                All household members are already in this project.
              </p>
            ) : (
              <div style={styles.tabContent}>
                {nonMembers.map((u) => {
                  console.log('avatar rendering, color_hex:', u.color_hex);
                  return (
                    <button
                      key={u.id}
                      style={styles.userPickerRow}
                      onClick={() => handleAddMember(u.id)}
                      disabled={isAddingMember}
                    >
                      <div style={{ ...styles.memberAvatarSmall, backgroundColor: u.color_hex }}>
                        {u.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={u.avatar_url}
                            alt=""
                            style={styles.memberAvatarSmallImg}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span style={styles.memberAvatarSmallFallback}>
                            {u.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span style={styles.userPickerName}>{u.name}</span>
                    </button>
                  );
                })}
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
  scroll: {
    flex: 1,
    overflowY: "auto",
    padding: "32px 24px",
    maxWidth: "680px",
    width: "100%",
    margin: "0 auto",
  },

  // Header
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "32px",
    gap: "16px",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
  },
  projectIcon: { fontSize: "2.5rem", lineHeight: 1, flexShrink: 0 },
  projectName: {
    fontSize: "1.5rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  memberAvatars: { display: "flex", alignItems: "center", flexShrink: 0 },
  memberAvatar: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    border: "2px solid var(--bg-primary)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  memberAvatarImg: { width: "100%", height: "100%", objectFit: "cover" },
  memberAvatarFallback: { fontSize: "0.6875rem", fontWeight: "600", color: "#fff" },
  memberAvatarMore: {
    backgroundColor: "var(--bg-secondary)",
    border: "2px solid var(--border)",
    fontSize: "0.625rem",
    fontWeight: "600",
    color: "var(--text-secondary)",
  },

  // Panels
  panel: {
    marginBottom: "16px",
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "var(--radius-lg)",
    padding: "20px",
    border: "1px solid var(--border)",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "12px",
  },
  panelLabel: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
  },
  panelAction: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--accent)",
    cursor: "pointer",
  },
  savingIndicator: { fontSize: "0.75rem", color: "var(--text-tertiary)" },

  // Instructions
  instructionsTextarea: {
    width: "100%",
    resize: "vertical",
    fontSize: "0.875rem",
    lineHeight: "1.6",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    fontFamily: "inherit",
    padding: "0",
    minHeight: "80px",
  },
  instructionsReadonly: {
    fontSize: "0.875rem",
    lineHeight: "1.6",
    color: "var(--text-primary)",
  },
  emptyState: { fontSize: "0.875rem", color: "var(--text-tertiary)" },

  // Files
  fileList: { display: "flex", flexDirection: "column", gap: "10px" },
  fileRow: { display: "flex", alignItems: "center", gap: "10px" },
  fileIcon: { fontSize: "1.125rem", flexShrink: 0 },
  fileInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
    flex: 1,
  },
  fileNameLink: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--accent)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textDecoration: "none",
  },
  fileName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fileMeta: { fontSize: "0.75rem", color: "var(--text-tertiary)" },

  // Members
  memberList: { display: "flex", flexDirection: "column", gap: "10px" },
  memberRow: { display: "flex", alignItems: "center", gap: "10px" },
  memberAvatarSmall: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  memberAvatarSmallImg: { width: "100%", height: "100%", objectFit: "cover" },
  memberAvatarSmallFallback: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    color: "#fff",
  },
  memberName: {
    flex: 1,
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
  roleBadge: {
    fontSize: "0.6875rem",
    fontWeight: "500",
    padding: "2px 7px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    color: "var(--text-tertiary)",
    textTransform: "capitalize",
  },
  roleBadgeOwner: {
    backgroundColor: "rgba(15, 110, 86, 0.08)",
    borderColor: "rgba(15, 110, 86, 0.2)",
    color: "var(--accent)",
  },
  removeButton: {
    fontSize: "1.125rem",
    lineHeight: 1,
    color: "var(--text-tertiary)",
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: "var(--radius-sm)",
  },

  // Connectors
  connectorList: { display: "flex", flexDirection: "column", gap: "10px" },
  connectorRow: { display: "flex", alignItems: "center", gap: "10px" },
  connectorIcon: { fontSize: "1.125rem", flexShrink: 0 },
  connectorName: {
    flex: 1,
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
  notConnectedBadge: {
    fontSize: "0.6875rem",
    fontWeight: "500",
    padding: "2px 7px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    color: "var(--text-tertiary)",
  },

  // Chats
  inlineInputBar: {
    flexShrink: 0,
    padding: "12px 24px 16px",
    borderTop: "1px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  inlineInputWrapper: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "10px 12px",
    maxWidth: "632px",
    margin: "0 auto",
  },
  inlineTextarea: {
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
  inlineSendButton: {
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
  inlineSendButtonDisabled: {
    opacity: 0.35,
    cursor: "not-allowed",
  },
  chatList: { display: "flex", flexDirection: "column", gap: "4px" },
  chatRow: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    textAlign: "left",
    cursor: "pointer",
    backgroundColor: "transparent",
    transition: "background-color var(--transition)",
    border: "1px solid transparent",
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
  chatTime: { fontSize: "0.6875rem", color: "var(--text-tertiary)", flexShrink: 0 },
  chatPreview: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  // Modals — shared
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
    border: "1px solid var(--border)",
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
    borderBottom: "1px solid var(--border)",
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

  // File picker tabs
  tabs: {
    display: "flex",
    borderBottom: "1px solid var(--border)",
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
  tabEmptyState: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    padding: "12px 8px",
    textAlign: "center",
  },

  // Browse Drive
  driveFileList: { display: "flex", flexDirection: "column", gap: "4px" },
  driveFileRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
  },
  driveFileInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  driveFileName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  attachButton: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    padding: "4px 10px",
    backgroundColor: "var(--accent)",
    color: "#fff",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    flexShrink: 0,
    transition: "opacity var(--transition)",
  },
  attachedBadge: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    padding: "4px 8px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    flexShrink: 0,
  },
  errorBox: { padding: "8px" },
  errorText: { fontSize: "0.8125rem", color: "#dc2626" },
  retryLink: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--accent)",
    cursor: "pointer",
    marginTop: "8px",
  },

  // Upload form
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
    border: "1px solid var(--border)",
    cursor: "pointer",
    transition: "border-color var(--transition), color var(--transition)",
  },
  typeOptionSelected: {
    color: "var(--accent)",
    borderColor: "var(--accent)",
    backgroundColor: "rgba(15, 110, 86, 0.06)",
  },
  uploadInput: {
    width: "100%",
    padding: "9px 12px",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
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
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    fontFamily: "inherit",
    resize: "vertical",
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
    transition: "opacity var(--transition)",
  },
  createButtonDisabled: { opacity: 0.5, cursor: "not-allowed" },

  // Context menu
  contextMenu: {
    position: "fixed" as const,
    zIndex: 500,
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
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
    transition: "background-color var(--transition)",
  },
  cancelButton: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-secondary)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
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
    transition: "opacity var(--transition)",
  },

  // Member picker
  userPickerRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background-color var(--transition)",
    backgroundColor: "transparent",
  },
  userPickerName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
};
