"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProjectRightPanel from "./ProjectRightPanel";
import { useChatContext } from "@/components/layout/ChatShell";
import type { FileAttachment } from "@/components/chat/MessageInput";
import type {
  ProjectMemberDetail,
  File as BruceFile,
  ChatPreview,
  UserSummary,
  DriveFile,
} from "@/lib/types";

const MAX_ATTACH_SIZE = 10 * 1024 * 1024;
const HOME_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const HOME_EXT_MEDIA: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", bmp: "image/jpeg",
};

function processAttachment(file: File): Promise<FileAttachment | null> {
  // Mobile camera capture often delivers file.type as "" — fall back to extension
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const isImage = file.type.startsWith("image/") || HOME_IMAGE_EXTS.has(ext);
  const type: "image" | "document" = isImage ? "image" : "document";
  const mediaType = isImage
    ? (file.type.startsWith("image/") ? file.type : (HOME_EXT_MEDIA[ext] ?? "image/jpeg"))
    : (file.type || "text/plain");
  const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl?.split(",")[1];
      if (!base64) { resolve(null); return; }
      resolve({ type, base64, mediaType, filename: file.name, fileSize: file.size, previewUrl });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

interface ProjectHomeProps {
  projectId: string;
  projectName: string;
  projectIcon: string;
  projectInstructions: string;
  projectOwnerId: string;
  projectIsolateMemory: boolean;
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
  projectIsolateMemory,
  members,
  files: initialFiles,
  initialChats,
  userId,
  userRole,
}: ProjectHomeProps) {
  const router = useRouter();
  const supabase = createClient();
  const { openDrawer } = useChatContext();
  const canEdit = userRole === "owner";

  // ── Instructions ──────────────────────────────────────────────
  const [instructions, setInstructions] = useState(projectInstructions);
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);

  // ── Memory isolation ──────────────────────────────────────────
  const [isolateMemory, setIsolateMemory] = useState(projectIsolateMemory);

  // ── Files ─────────────────────────────────────────────────────
  const [fileList, setFileList] = useState<BruceFile[]>(initialFiles);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [filePickerTab, setFilePickerTab] = useState<"browse" | "upload">("browse");
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [isBrowseLoading, setIsBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [browsePath, setBrowsePath] = useState<Array<{ id: string; name: string }>>([]);
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
  const [inlineFiles, setInlineFiles] = useState<FileAttachment[]>([]);
  const inlineFileInputRef = useRef<HTMLInputElement>(null);

  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);

  // ── Rename ────────────────────────────────────────────────────
  const [renameTarget, setRenameTarget] = useState<{ id: string; currentTitle: string } | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [isRenameSaving, setIsRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Chat select mode ──────────────────────────────────────────
  const [chatsSelectMode, setChatsSelectMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  // ── Memory isolation ──────────────────────────────────────────

  const handleIsolateMemoryChange = useCallback(
    async (value: boolean) => {
      setIsolateMemory(value);
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isolate_memory: value }),
      });
    },
    [projectId]
  );

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
    setBrowsePath([]);
    if (tab === "browse") await loadDriveFiles(undefined);
  }

  async function loadDriveFiles(folderId: string | undefined) {
    setIsBrowseLoading(true);
    setBrowseError(null);
    try {
      const url = folderId
        ? `/api/projects/${projectId}/files/browse?folderId=${encodeURIComponent(folderId)}`
        : `/api/projects/${projectId}/files/browse`;
      const res = await fetch(url);
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

  async function handleBrowseFolder(folder: DriveFile) {
    setBrowsePath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    await loadDriveFiles(folder.id);
  }

  async function handleBrowseUp(index: number) {
    const newPath = browsePath.slice(0, index);
    setBrowsePath(newPath);
    const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : undefined;
    await loadDriveFiles(parentId);
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

  async function handleInlineFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const results = await Promise.all(
      files.filter((f) => f.size <= MAX_ATTACH_SIZE).map(processAttachment)
    );
    const valid = results.filter((r): r is FileAttachment => r !== null);
    if (valid.length > 0) setInlineFiles((prev) => [...prev, ...valid]);
  }

  async function handleSendInlineMessage() {
    const text = inlineInput.trim();
    if ((!text && !inlineFiles.length) || isCreatingChat) return;
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

      if (inlineFiles.length > 0) {
        try {
          // Strip previewUrl (object URLs won't survive navigation)
          sessionStorage.setItem(
            `bruce_project_initial_files_${chat.id}`,
            JSON.stringify(inlineFiles.map(({ previewUrl: _, ...rest }) => rest))
          );
        } catch { /* sessionStorage unavailable */ }
      }

      const url = text
        ? `/projects/${projectId}/chat/${chat.id}?q=${encodeURIComponent(text)}`
        : `/projects/${projectId}/chat/${chat.id}`;
      router.push(url);
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

  function openRename(id: string) {
    const chat = chats.find((c) => c.id === id);
    const currentTitle = chat?.title ?? "New conversation";
    setRenameTarget({ id, currentTitle });
    setRenameInput(currentTitle);
    setTimeout(() => renameInputRef.current?.select(), 50);
  }

  async function handleRenameSave() {
    if (!renameTarget || isRenameSaving) return;
    const newTitle = renameInput.trim();
    if (!newTitle || newTitle === renameTarget.currentTitle) {
      setRenameTarget(null);
      return;
    }
    setIsRenameSaving(true);
    // Optimistic update
    setChats((prev) => prev.map((c) => c.id === renameTarget.id ? { ...c, title: newTitle } : c));
    const { error } = await supabase
      .from("chats")
      .update({ title: newTitle })
      .eq("id", renameTarget.id);
    if (error) {
      // Roll back on failure
      setChats((prev) => prev.map((c) => c.id === renameTarget.id ? { ...c, title: renameTarget.currentTitle } : c));
    }
    setIsRenameSaving(false);
    setRenameTarget(null);
  }

  // ── Chat select mode ──────────────────────────────────────────

  function enterChatsSelectMode() {
    setContextMenu(null);
    setSelectedChatIds(new Set());
    setChatsSelectMode(true);
  }

  function exitChatsSelectMode() {
    setChatsSelectMode(false);
    setSelectedChatIds(new Set());
  }

  function toggleChatSelection(id: string) {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    if (isDeletingBulk || selectedChatIds.size === 0) return;
    setIsDeletingBulk(true);
    try {
      const ids = Array.from(selectedChatIds);
      const res = await fetch("/api/chats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        setShowBulkDeleteConfirm(false);
        exitChatsSelectMode();
        setChats((prev) => prev.filter((c) => !ids.includes(c.id)));
      }
    } finally {
      setIsDeletingBulk(false);
    }
  }

  // ── Computed ──────────────────────────────────────────────────

  const visibleMemberAvatars = memberList.slice(0, 4);
  const attachedDriveIds = new Set(fileList.map((f) => f.google_drive_file_id));
  const nonMembers = allUsers.filter((u) => !memberList.some((m) => m.id === u.id));

  // ── Render ────────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {/* Mobile top bar with hamburger — hidden on desktop via .mobile-only */}
      <div className="mobile-only" style={styles.mobileTopBar}>
        <button
          onClick={openDrawer}
          style={styles.hamburger}
          aria-label="Open menu"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <span style={styles.mobileTopBarTitle}>{projectName}</span>
        <div style={{ width: 36 }} />
      </div>

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
            <div style={styles.newChatWrapper}>
              {inlineFiles.length > 0 && (
                <div style={styles.newChatChipsRow}>
                  {inlineFiles.map((file, i) => (
                    <div key={i} style={styles.newChatChip}>
                      {file.type === "image" && file.previewUrl ? (
                        <div style={styles.newChatThumbWrapper}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={file.previewUrl} alt="" style={styles.newChatThumb} />
                          <button onClick={() => setInlineFiles((p) => p.filter((_, idx) => idx !== i))} style={styles.newChatChipClose} aria-label="Remove">×</button>
                        </div>
                      ) : (
                        <div style={styles.newChatDocChip}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--text-secondary)" }}>
                            <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                            <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                          <span style={styles.newChatDocName}>{file.filename}</span>
                          <button onClick={() => setInlineFiles((p) => p.filter((_, idx) => idx !== i))} style={styles.newChatChipClose} aria-label="Remove">×</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={styles.newChatBox}>
                <input
                  ref={inlineFileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.csv,image/*"
                  style={{ display: "none" }}
                  onChange={handleInlineFileChange}
                />
                <button
                  onClick={() => inlineFileInputRef.current?.click()}
                  style={styles.newChatAttachBtn}
                  aria-label="Attach file"
                  type="button"
                  disabled={isCreatingChat}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M15 9.5l-5.5 5.5a4 4 0 0 1-5.657-5.657l6-6a2.5 2.5 0 0 1 3.535 3.535L7.5 12.5a1 1 0 0 1-1.414-1.414L11.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
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
                  rows={1}
                  disabled={isCreatingChat}
                />
                <button
                  style={{
                    ...styles.newChatSend,
                    ...(!inlineInput.trim() && !inlineFiles.length || isCreatingChat ? styles.newChatSendDisabled : {}),
                  }}
                  onClick={handleSendInlineMessage}
                  disabled={(!inlineInput.trim() && !inlineFiles.length) || isCreatingChat}
                >
                  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 12V4M4 8l4-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Chats list */}
            <div style={styles.chatsSection}>
              <div style={styles.sectionHeader}>
                <span style={styles.sectionLabel}>Chats</span>
                {chats.length > 0 && (
                  chatsSelectMode ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {chats.length > 1 && (
                        <button
                          style={styles.sectionEditButton}
                          onClick={() => {
                            if (selectedChatIds.size === chats.length) {
                              setSelectedChatIds(new Set());
                            } else {
                              setSelectedChatIds(new Set(chats.map((c) => c.id)));
                            }
                          }}
                        >
                          {selectedChatIds.size === chats.length ? "Deselect All" : "Select All"}
                        </button>
                      )}
                      <button style={styles.sectionEditButton} onClick={exitChatsSelectMode}>Done</button>
                    </div>
                  ) : (
                    <button style={styles.sectionEditButton} onClick={enterChatsSelectMode}>Edit</button>
                  )
                )}
              </div>
              {chats.length === 0 ? (
                <p style={styles.emptyState}>No conversations yet.</p>
              ) : (
                <>
                <div style={styles.chatList}>
                  {chats.map((chat) => {
                    const isSelected = selectedChatIds.has(chat.id);
                    if (chatsSelectMode) {
                      return (
                        <button
                          key={chat.id}
                          style={{ ...styles.chatRow, flexDirection: "row", alignItems: "center", gap: "10px" }}
                          onClick={() => toggleChatSelection(chat.id)}
                        >
                          <div style={{
                            ...styles.chatSelectCircle,
                            ...(isSelected ? { backgroundColor: "var(--accent)", borderColor: "var(--accent)" } : {}),
                          }}>
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                                <path d="M1.5 5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <div style={{ ...styles.chatRowTop, flex: 1, minWidth: 0 }}>
                            <span style={styles.chatTitle}>{chat.title ?? "New conversation"}</span>
                            <span style={styles.chatTime}>{formatRelativeTime(chat.last_message_at)}</span>
                          </div>
                        </button>
                      );
                    }
                    return (
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
                    );
                  })}
                </div>
                {chatsSelectMode && (
                  <button
                    onClick={() => { if (selectedChatIds.size > 0) setShowBulkDeleteConfirm(true); }}
                    disabled={selectedChatIds.size === 0}
                    style={{
                      ...styles.deleteSelectedButton,
                      ...(selectedChatIds.size === 0 ? styles.deleteSelectedButtonDisabled : {}),
                    }}
                  >
                    {selectedChatIds.size === 0
                      ? "Select chats to delete"
                      : `Delete ${selectedChatIds.size} ${selectedChatIds.size === 1 ? "chat" : "chats"}`}
                  </button>
                )}
                </>
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
            isolateMemory={isolateMemory}
            onIsolateMemoryChange={handleIsolateMemoryChange}
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
            style={{ ...styles.contextMenuItem, color: "var(--text-primary)", borderBottom: "0.5px solid var(--border)" }}
            onClick={() => {
              openRename(contextMenu.id);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
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

      {/* Rename chat modal */}
      {renameTarget && (
        <div style={styles.modalOverlay} onClick={() => setRenameTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>Rename chat</span>
              <button style={styles.modalClose} onClick={() => setRenameTarget(null)}>×</button>
            </div>
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                ref={renameInputRef}
                style={styles.renameInput}
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSave();
                  if (e.key === "Escape") setRenameTarget(null);
                }}
                placeholder="Chat name"
                autoFocus
              />
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  style={styles.cancelButton}
                  onClick={() => setRenameTarget(null)}
                  disabled={isRenameSaving}
                >
                  Cancel
                </button>
                <button
                  style={{ ...styles.deleteConfirmButton, backgroundColor: "var(--accent)", ...(isRenameSaving || !renameInput.trim() ? { opacity: 0.5, cursor: "not-allowed" } : {}) }}
                  onClick={handleRenameSave}
                  disabled={isRenameSaving || !renameInput.trim()}
                >
                  {isRenameSaving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
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

      {/* Bulk delete confirmation */}
      {showBulkDeleteConfirm && (
        <div style={styles.modalOverlay} onClick={() => setShowBulkDeleteConfirm(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>
                Delete {selectedChatIds.size} {selectedChatIds.size === 1 ? "chat" : "chats"}?
              </span>
              <button style={styles.modalClose} onClick={() => setShowBulkDeleteConfirm(false)}>×</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "20px" }}>
                This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  style={styles.cancelButton}
                  onClick={() => setShowBulkDeleteConfirm(false)}
                  disabled={isDeletingBulk}
                >
                  Cancel
                </button>
                <button
                  style={{ ...styles.deleteConfirmButton, ...(isDeletingBulk ? { opacity: 0.6 } : {}) }}
                  onClick={handleBulkDelete}
                  disabled={isDeletingBulk}
                >
                  {isDeletingBulk ? "Deleting…" : "Delete"}
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
                    if (t === "browse" && driveFiles.length === 0 && !isBrowseLoading) await loadDriveFiles(undefined);
                  }}
                >
                  {t === "browse" ? "Browse Drive" : "Upload new"}
                </button>
              ))}
            </div>
            {filePickerTab === "browse" && (
              <div style={styles.tabContent}>
                {browsePath.length > 0 && (
                  <div style={styles.breadcrumbs}>
                    <button style={styles.breadcrumbItem} onClick={() => handleBrowseUp(0)}>
                      Project folder
                    </button>
                    {browsePath.map((crumb, i) => (
                      <span key={crumb.id} style={styles.breadcrumbRow}>
                        <span style={styles.breadcrumbSep}>/</span>
                        {i < browsePath.length - 1 ? (
                          <button style={styles.breadcrumbItem} onClick={() => handleBrowseUp(i + 1)}>
                            {crumb.name}
                          </button>
                        ) : (
                          <span style={styles.breadcrumbCurrent}>{crumb.name}</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {isBrowseLoading ? (
                  <p style={styles.tabEmpty}>Loading…</p>
                ) : browseError ? (
                  <div>
                    <p style={styles.errorText}>{browseError}</p>
                    <button style={styles.retryLink} onClick={() => loadDriveFiles(browsePath.length > 0 ? browsePath[browsePath.length - 1].id : undefined)}>Try again</button>
                  </div>
                ) : driveFiles.length === 0 ? (
                  <p style={styles.tabEmpty}>No files in this folder.</p>
                ) : (
                  <div style={styles.fileList}>
                    {driveFiles.map((f) => {
                      const attached = attachedDriveIds.has(f.id);
                      return (
                        <div key={f.id} style={styles.fileRow}>
                          <span style={styles.fileIcon}>{getMimeIcon(f.mimeType)}</span>
                          <div style={styles.fileInfo}>
                            <span style={styles.driveFileName}>{f.name}</span>
                            {!f.isFolder && <span style={styles.fileMeta}>{formatRelativeTime(f.modifiedTime)}</span>}
                          </div>
                          {f.isFolder ? (
                            <button style={styles.attachButton} onClick={() => handleBrowseFolder(f)}>
                              Open
                            </button>
                          ) : attached ? (
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

  mobileTopBar: {
    height: "var(--topbar-height)",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    flexShrink: 0,
  },
  hamburger: {
    width: "36px",
    height: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    padding: 0,
    flexShrink: 0,
  },
  mobileTopBarTitle: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
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
  newChatWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  newChatChipsRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap" as const,
  },
  newChatChip: {
    flexShrink: 0,
  },
  newChatThumbWrapper: {
    position: "relative" as const,
    display: "inline-block",
  },
  newChatThumb: {
    width: "48px",
    height: "48px",
    borderRadius: "var(--radius-md)",
    objectFit: "cover" as const,
    display: "block",
  },
  newChatDocChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
    backgroundColor: "var(--bg-secondary)",
    maxWidth: "200px",
  },
  newChatDocName: {
    fontSize: "0.8125rem",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: "120px",
  },
  newChatChipClose: {
    fontSize: "0.875rem",
    lineHeight: 1,
    color: "var(--text-tertiary)",
    cursor: "pointer",
    padding: "2px 4px",
    flexShrink: 0,
    backgroundColor: "transparent",
    border: "none",
  },
  newChatBox: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    padding: "10px 10px 10px 14px",
  },
  newChatAttachBtn: {
    flexShrink: 0,
    width: "36px",
    height: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    padding: 0,
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
    padding: "6px 0",
    minHeight: "44px",
    maxHeight: "160px",
    overflowY: "auto" as const,
    caretColor: "var(--accent)",
  },
  newChatSend: {
    width: "36px",
    height: "36px",
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--accent)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    transition: "opacity var(--transition)",
    border: "none",
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
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--text-tertiary)",
  },
  sectionEditButton: {
    fontSize: "0.75rem",
    fontWeight: "500",
    color: "var(--accent)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: "var(--radius-sm)",
  },
  chatSelectCircle: {
    width: "18px",
    height: "18px",
    borderRadius: "var(--radius-full)",
    border: "1.5px solid var(--border-strong)",
    backgroundColor: "var(--bg-secondary)",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteSelectedButton: {
    width: "100%",
    marginTop: "4px",
    padding: "10px 12px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#dc2626",
    backgroundColor: "rgba(220, 38, 38, 0.07)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    textAlign: "left" as const,
    border: "none",
    transition: "background-color var(--transition)",
  },
  deleteSelectedButtonDisabled: {
    color: "var(--text-tertiary)",
    backgroundColor: "transparent",
    cursor: "default",
  },
  emptyState: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    padding: "8px 0",
  },
  chatList: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },
  chatRow: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "12px 12px",
    borderRadius: "var(--radius-md)",
    textAlign: "left",
    cursor: "pointer",
    backgroundColor: "transparent",
    transition: "background-color var(--transition)",
    border: "none",
    borderBottom: "0.5px solid var(--border)",
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
  breadcrumbs: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "2px",
    marginBottom: "10px",
    fontSize: "0.8125rem",
  },
  breadcrumbRow: { display: "flex", alignItems: "center", gap: "2px" },
  breadcrumbSep: { color: "var(--text-tertiary)", padding: "0 2px" },
  breadcrumbItem: {
    color: "var(--accent)",
    cursor: "pointer",
    fontWeight: "500",
    padding: "0",
    background: "none",
    border: "none",
    fontSize: "0.8125rem",
  },
  breadcrumbCurrent: { color: "var(--text-primary)", fontWeight: "500" },
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
  renameInput: {
    width: "100%",
    padding: "9px 12px",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "0.5px solid var(--border)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box" as const,
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
