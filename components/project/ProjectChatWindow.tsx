"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProjectTopBar from "./ProjectTopBar";
import ProjectChatTabs from "./ProjectChatTabs";
import ProjectRightPanel from "./ProjectRightPanel";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import type { FileAttachment } from "@/components/chat/MessageInput";
import type { ChatMessage } from "@/components/chat/MessageList";
import type {
  Message,
  MessageRole,
  ProjectMemberDetail,
  File as BruceFile,
  ChatPreview,
  UserSummary,
  DriveFile,
} from "@/lib/types";
import { modelLabel } from "@/lib/models";

interface ProjectChatWindowProps {
  chatId: string;
  projectId: string;
  projectName: string;
  projectIcon: string;
  projectInstructions: string;
  projectOwnerId: string;
  initialMessages: Message[];
  initialTitle: string;
  initialInput?: string;
  userColorHex?: string;
  initialModel?: string;
  currentUserId: string;
  members: ProjectMemberDetail[];
  userRole: "owner" | "member";
  initialFiles: BruceFile[];
  initialAllChats: ChatPreview[];
}

// ── File picker helpers ─────────────────────────────────────────

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
  const s = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Component ───────────────────────────────────────────────────

export default function ProjectChatWindow({
  chatId,
  projectId,
  projectName,
  projectIcon,
  projectInstructions,
  projectOwnerId,
  initialMessages,
  initialInput,
  userColorHex,
  initialModel,
  currentUserId,
  members: initialMembers,
  userRole,
  initialFiles,
  initialAllChats,
}: ProjectChatWindowProps) {
  const router = useRouter();
  const canEdit = userRole === "owner";

  // ── Member map ref for realtime sender attribution ──────────────
  const memberMapRef = useRef<Record<string, { name: string; color_hex: string }>>(
    Object.fromEntries(initialMembers.map((m) => [m.id, { name: m.name, color_hex: m.color_hex }]))
  );
  const isStreamingRef = useRef(false);

  // ── Chat messages state ─────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((m) => {
      const senderInfo = m.sender_id ? memberMapRef.current[m.sender_id] : null;
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        metadata: (m.metadata as Record<string, unknown>) ?? undefined,
        imageUrl: (m.image_url as string | undefined) ?? undefined,
        attachmentType: (m.attachment_type as string | undefined) ?? undefined,
        attachmentFilename: (m.attachment_filename as string | undefined) ?? undefined,
        sender_id: m.sender_id,
        senderName: senderInfo?.name,
        senderColorHex: senderInfo?.color_hex,
      };
    })
  );

  const [isClient, setIsClient] = useState(() => typeof window !== "undefined");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<string | undefined>(undefined);
  const [attachedFile, setAttachedFile] = useState<FileAttachment | null>(null);
  const [model, setModel] = useState(initialModel ?? "claude-sonnet-4-6");

  // ── Right panel state ───────────────────────────────────────────
  const [rightPanelOpen, setRightPanelOpen] = useState(false); // mobile drawer

  // ── Project metadata state ──────────────────────────────────────
  const [instructions, setInstructions] = useState(projectInstructions);
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);
  const [fileList, setFileList] = useState<BruceFile[]>(initialFiles);
  const [memberList, setMemberList] = useState<ProjectMemberDetail[]>(initialMembers);

  // ── File picker modal state ─────────────────────────────────────
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

  // ── Member picker modal state ───────────────────────────────────
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [allUsers, setAllUsers] = useState<UserSummary[]>([]);
  const [isAddingMember, setIsAddingMember] = useState(false);

  // ── Chat creation state ─────────────────────────────────────────
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────
  const instructionsSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesRef = useRef(messages);
  const instructionsFiredRef = useRef(false);
  const initialSentRef = useRef(false);

  // ── Effects ─────────────────────────────────────────────────────

  useEffect(() => { setIsClient(true); }, []);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  // Geolocation
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
            { headers: { "User-Agent": "BruceHouseholdAI/1.0" } }
          );
          const data = await res.json() as { address?: { city?: string; town?: string; village?: string; state?: string } };
          const city = data.address?.city ?? data.address?.town ?? data.address?.village;
          const state = data.address?.state;
          if (city && state) setCurrentLocation(`${city}, ${state}`);
          else if (state) setCurrentLocation(state);
        } catch { /* silent */ }
      },
      () => {},
      { timeout: 5000 }
    );
  }, []);

  // Living instructions update on unmount
  useEffect(() => {
    return () => {
      if (!instructionsFiredRef.current && messagesRef.current.length >= 2) {
        instructionsFiredRef.current = true;
        fetch(`/api/projects/${projectId}/instructions/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-send initial message from project home inline input
  useEffect(() => {
    if (initialInput && !initialSentRef.current) {
      initialSentRef.current = true;
      router.replace(`/projects/${projectId}/chat/${chatId}`, { scroll: false });
      sendMessage(initialInput, undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: messages from other members
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`project-chat-${chatId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const msg = payload.new as {
            id: string;
            sender_id: string | null;
            role: string;
            content: string;
            created_at: string;
            metadata: Record<string, unknown> | null;
            image_url: string | null;
            attachment_type: string | null;
            attachment_filename: string | null;
          };
          if (msg.sender_id === currentUserId) return;
          if (msg.sender_id === null && isStreamingRef.current) return;
          const senderInfo = msg.sender_id ? memberMapRef.current[msg.sender_id] : null;
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [
              ...prev,
              {
                id: msg.id,
                role: msg.role as MessageRole,
                content: msg.content,
                created_at: msg.created_at,
                metadata: msg.metadata ?? undefined,
                imageUrl: msg.image_url ?? undefined,
                attachmentType: msg.attachment_type ?? undefined,
                attachmentFilename: msg.attachment_filename ?? undefined,
                sender_id: msg.sender_id,
                senderName: senderInfo?.name,
                senderColorHex: senderInfo?.color_hex,
              },
            ];
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId, currentUserId]);

  // ── Message loading ─────────────────────────────────────────────

  const loadMessages = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("id, sender_id, role, content, created_at, metadata, image_url, attachment_type, attachment_filename")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (!data) return;
    setMessages(
      (data as Array<{
        id: string;
        sender_id: string | null;
        role: string;
        content: string;
        created_at: string;
        metadata: Record<string, unknown> | null;
        image_url?: string | null;
        attachment_type?: string | null;
        attachment_filename?: string | null;
      }>).map((m) => {
        const senderInfo = m.sender_id ? memberMapRef.current[m.sender_id] : null;
        return {
          id: m.id,
          role: m.role as MessageRole,
          content: m.content,
          created_at: m.created_at,
          metadata: m.metadata ?? undefined,
          imageUrl: m.image_url ?? undefined,
          attachmentType: m.attachment_type ?? undefined,
          attachmentFilename: m.attachment_filename ?? undefined,
          sender_id: m.sender_id,
          senderName: senderInfo?.name,
          senderColorHex: senderInfo?.color_hex,
        };
      })
    );
  }, [chatId]);

  // ── Model change ────────────────────────────────────────────────

  async function handleModelChange(newModel: string) {
    setModel(newModel);
    setMessages((prev) => [
      ...prev,
      {
        id: `model-switch-${Date.now()}`,
        role: "system" as MessageRole,
        content: `Switched to ${modelLabel(newModel)}`,
        created_at: new Date().toISOString(),
      },
    ]);
    await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_model: newModel }),
    });
  }

  // ── New chat ────────────────────────────────────────────────────

  async function handleNewChat() {
    if (isCreatingChat) return;
    setIsCreatingChat(true);
    try {
      const supabase = createClient();
      const { data: chat } = await supabase
        .from("chats")
        .insert({
          owner_id: currentUserId,
          project_id: projectId,
          type: "private",
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (chat) router.push(`/projects/${projectId}/chat/${chat.id}`);
    } finally {
      setIsCreatingChat(false);
    }
  }

  function handleTabSelect(targetChatId: string) {
    if (targetChatId !== chatId) {
      router.push(`/projects/${projectId}/chat/${targetChatId}`);
    }
  }

  // ── Instructions ────────────────────────────────────────────────

  async function saveInstructions() {
    if (instructions === projectInstructions) return;
    setIsSavingInstructions(true);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions }),
      });
    } finally {
      setIsSavingInstructions(false);
    }
  }

  // ── Files ───────────────────────────────────────────────────────

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

  // ── Members ─────────────────────────────────────────────────────

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
          const newMember: ProjectMemberDetail = {
            id: added.id,
            name: added.name,
            avatar_url: added.avatar_url,
            color_hex: added.color_hex,
            role: "member",
          };
          setMemberList((prev) => [...prev, newMember]);
          memberMapRef.current[added.id] = { name: added.name, color_hex: added.color_hex };
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

  // ── Send message ────────────────────────────────────────────────

  async function sendMessage(text: string, fileOverride?: FileAttachment | null) {
    const fileToSend = fileOverride !== undefined ? fileOverride : attachedFile;
    if ((!text && !fileToSend) || isStreaming) return;

    setInput("");
    setAttachedFile(null);
    setError(null);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
        imageUrl: fileToSend?.type === "image" ? fileToSend.previewUrl : undefined,
        attachmentType: fileToSend?.type,
        attachmentFilename: fileToSend?.filename,
        sender_id: currentUserId,
      },
      { id: streamMsgId, role: "assistant", content: "", isStreaming: true },
    ]);
    setIsStreaming(true);

    let hadImageReq = false;
    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId,
          currentLocation,
          image: fileToSend?.type === "image"
            ? { base64: fileToSend.base64, mediaType: fileToSend.mediaType }
            : undefined,
          document: fileToSend?.type === "document"
            ? { base64: fileToSend.base64, mediaType: fileToSend.mediaType, filename: fileToSend.filename }
            : undefined,
        }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let sentinelSeen = false;
      const STATUS_RE = /\x1eSTATUS:[^\x1e]*\x1e/g;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        const statusMatch = /\x1eSTATUS:([^\x1e]*)\x1e/.exec(accumulated);
        if (statusMatch) setWorkingStatus(statusMatch[1]);

        if (sentinelSeen) continue;
        const sentinelIdx = accumulated.indexOf("\x1f");
        if (sentinelIdx !== -1) {
          sentinelSeen = true;
          const display = accumulated.slice(0, sentinelIdx)
            .replace(STATUS_RE, "")
            .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
            .trim();
          if (display) setWorkingStatus(null);
          setMessages((prev) =>
            prev.map((m) => m.id === streamMsgId ? { ...m, content: display } : m)
          );
        } else {
          const display = accumulated
            .replace(STATUS_RE, "")
            .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
            .trimStart();
          if (display.trim()) setWorkingStatus(null);
          setMessages((prev) =>
            prev.map((m) => m.id === streamMsgId ? { ...m, content: display } : m)
          );
        }
      }

      setWorkingStatus(null);

      const sentinelParts = accumulated.split("\x1f");
      const imageReqSentinel = sentinelParts.find((p) => p.startsWith("IMAGE_REQ:"));

      const finalText = sentinelParts[0]
        .replace(STATUS_RE, "")
        .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
        .trim();

      if (imageReqSentinel && isClient) {
        hadImageReq = true;
        try {
          const reqData = JSON.parse(imageReqSentinel.slice("IMAGE_REQ:".length)) as {
            prompt: string;
            quality: string;
            chatId: string;
          };
          const skeletonId = `skeleton-${Date.now()}`;
          setMessages((prev) => {
            const withoutStream = prev.filter((m) => m.id !== streamMsgId);
            const skeleton: ChatMessage = {
              id: skeletonId,
              role: "assistant",
              content: "",
              created_at: new Date().toISOString(),
              metadata: { content_type: "image", image_url: "", prompt: reqData.prompt, quality: reqData.quality },
            };
            if (finalText) {
              return [...withoutStream, skeleton, {
                id: `text-${Date.now()}`,
                role: "assistant" as const,
                content: finalText,
                isStreaming: false,
                created_at: new Date().toISOString(),
              }];
            }
            return [...withoutStream, skeleton];
          });
          const imgRes = await fetch("/api/images/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: reqData.prompt, chatId: reqData.chatId, quality: reqData.quality }),
          });
          if (imgRes.ok) {
            const imgData = await imgRes.json() as {
              messageId: string; url: string; prompt: string; model: string; quality: string;
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === skeletonId
                  ? {
                      id: imgData.messageId,
                      role: "assistant" as const,
                      content: `[Image: ${imgData.prompt.slice(0, 100)}]`,
                      created_at: new Date().toISOString(),
                      metadata: {
                        content_type: "image",
                        image_url: imgData.url,
                        prompt: imgData.prompt,
                        model: imgData.model,
                        quality: imgData.quality,
                      },
                    }
                  : m
              )
            );
          } else {
            setMessages((prev) => prev.filter((m) => m.id !== skeletonId));
          }
        } catch (err) {
          console.error("[client] image generation catch:", err);
        }
      } else {
        if (finalText) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamMsgId
                ? { ...m, content: finalText, isStreaming: false, created_at: new Date().toISOString() }
                : m
            )
          );
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
        }
      }
    } catch (err) {
      console.error("[ProjectChatWindow] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
      if (!hadImageReq) await loadMessages();
    }
  }

  function handleSend() { sendMessage(input.trim()); }

  function handleRetry() {
    setError(null);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      setMessages((prev) => prev.filter((m) => m.id !== lastUser.id));
    }
  }

  const attachedDriveIds = new Set(fileList.map((f) => f.google_drive_file_id));
  const nonMembers = allUsers.filter((u) => !memberList.some((m) => m.id === u.id));

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      {/* Top bar */}
      <ProjectTopBar
        projectId={projectId}
        projectName={projectName}
        projectIcon={projectIcon}
        members={memberList}
        model={model}
        onModelChange={handleModelChange}
        onNewChat={handleNewChat}
        onTogglePanel={() => setRightPanelOpen((v) => !v)}
      />

      {/* Chat history tabs */}
      <ProjectChatTabs
        chats={initialAllChats}
        activeChatId={chatId}
        onSelect={handleTabSelect}
        onNewChat={handleNewChat}
        isCreating={isCreatingChat}
      />

      {/* Main content row: chat + right panel */}
      <div style={styles.contentRow}>
        {/* Chat column */}
        <div style={styles.chatColumn}>
          <MessageList
            messages={messages}
            onRefresh={loadMessages}
            userColorHex={userColorHex}
            streamingStatus={workingStatus}
            currentUserId={currentUserId}
          />

          {error && (
            <div style={styles.errorRow}>
              <span style={styles.errorText}>{error}</span>
              <button onClick={handleRetry} style={styles.retryButton}>Retry</button>
            </div>
          )}

          <MessageInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={isStreaming}
            attachedFile={attachedFile}
            onFileAttach={(f) => setAttachedFile(f)}
            onFileClear={() => setAttachedFile(null)}
            placeholder={`Message ${projectName}…`}
          />
        </div>

        {/* Right panel — in-flow on desktop, fixed drawer on mobile */}
        <div className={`right-panel-container${rightPanelOpen ? " panel-open" : ""}`}>
          <ProjectRightPanel
            projectId={projectId}
            canEdit={canEdit}
            instructions={instructions}
            onInstructionsChange={setInstructions}
            onInstructionsSave={saveInstructions}
            isSavingInstructions={isSavingInstructions}
            files={fileList}
            onOpenFilePicker={() => openFilePicker("browse")}
            onDetachFile={handleDetachFile}
            members={memberList}
            userId={currentUserId}
            onOpenMemberPicker={handleOpenMemberPicker}
            onRemoveMember={handleRemoveMember}
          />
        </div>
      </div>

      {/* Mobile panel backdrop */}
      <div
        className={`panel-backdrop${rightPanelOpen ? " panel-open" : ""}`}
        onClick={() => setRightPanelOpen(false)}
      />

      {/* ── File picker modal ── */}
      {showFilePicker && (
        <div style={modalStyles.overlay} onClick={() => setShowFilePicker(false)}>
          <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={modalStyles.header}>
              <span style={modalStyles.title}>Attach file</span>
              <button style={modalStyles.closeBtn} onClick={() => setShowFilePicker(false)}>×</button>
            </div>
            <div style={modalStyles.tabs}>
              {(["browse", "upload"] as const).map((t) => (
                <button
                  key={t}
                  style={{ ...modalStyles.tab, ...(filePickerTab === t ? modalStyles.tabActive : {}) }}
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
              <div style={modalStyles.body}>
                {isBrowseLoading ? (
                  <p style={modalStyles.emptyState}>Loading Drive files…</p>
                ) : browseError ? (
                  <div>
                    <p style={modalStyles.errorText}>{browseError}</p>
                    <button style={modalStyles.retryLink} onClick={loadDriveFiles}>Try again</button>
                  </div>
                ) : driveFiles.length === 0 ? (
                  <p style={modalStyles.emptyState}>No files in your Bruce Drive folder.</p>
                ) : (
                  <div style={modalStyles.fileList}>
                    {driveFiles.map((f) => {
                      const attached = attachedDriveIds.has(f.id);
                      return (
                        <div key={f.id} style={modalStyles.fileRow}>
                          <span style={modalStyles.fileIcon}>{getMimeIcon(f.mimeType)}</span>
                          <div style={modalStyles.fileInfo}>
                            <span style={modalStyles.driveFileName}>{f.name}</span>
                            <span style={modalStyles.fileMeta}>{formatRelativeTime(f.modifiedTime)}</span>
                          </div>
                          {attached ? (
                            <span style={modalStyles.attachedBadge}>Attached</span>
                          ) : (
                            <button
                              style={modalStyles.attachBtn}
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
              <div style={modalStyles.body}>
                <div style={modalStyles.uploadForm}>
                  <div style={modalStyles.typeRow}>
                    {(["note", "doc", "sheet"] as const).map((t) => (
                      <button
                        key={t}
                        style={{ ...modalStyles.typeOption, ...(uploadType === t ? modalStyles.typeOptionSelected : {}) }}
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
                    style={modalStyles.input}
                  />
                  <textarea
                    placeholder={uploadType === "sheet" ? "CSV content" : "Content (optional)"}
                    value={uploadContent}
                    onChange={(e) => setUploadContent(e.target.value)}
                    style={modalStyles.textarea}
                    rows={5}
                  />
                  {uploadError && <p style={modalStyles.errorText}>{uploadError}</p>}
                  <button
                    style={{ ...modalStyles.createBtn, ...(!uploadName.trim() || isUploading ? modalStyles.createBtnDisabled : {}) }}
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

      {/* ── Member picker modal ── */}
      {showMemberPicker && (
        <div style={modalStyles.overlay} onClick={() => setShowMemberPicker(false)}>
          <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={modalStyles.header}>
              <span style={modalStyles.title}>Add member</span>
              <button style={modalStyles.closeBtn} onClick={() => setShowMemberPicker(false)}>×</button>
            </div>
            {nonMembers.length === 0 ? (
              <p style={{ ...modalStyles.emptyState, padding: "20px" }}>
                All household members are already in this project.
              </p>
            ) : (
              <div style={modalStyles.body}>
                {nonMembers.map((u) => (
                  <button
                    key={u.id}
                    style={modalStyles.userPickerRow}
                    onClick={() => handleAddMember(u.id)}
                    disabled={isAddingMember}
                  >
                    <div style={{ ...modalStyles.userPickerAvatar, backgroundColor: u.color_hex }}>
                      {u.name[0].toUpperCase()}
                    </div>
                    <span style={modalStyles.userPickerName}>{u.name}</span>
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

// ── Layout styles ───────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    backgroundColor: "var(--bg-primary)",
  },
  contentRow: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
    minHeight: 0,
  },
  chatColumn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },
  errorRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "8px 16px",
    flexShrink: 0,
  },
  errorText: { fontSize: "0.8125rem", color: "var(--text-secondary)" },
  retryButton: { fontSize: "0.8125rem", fontWeight: "500", color: "var(--accent)", cursor: "pointer" },
};

// ── Modal styles ────────────────────────────────────────────────

const modalStyles: Record<string, React.CSSProperties> = {
  overlay: {
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
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "0.5px solid var(--border)",
    flexShrink: 0,
  },
  title: { fontSize: "0.9375rem", fontWeight: "600", color: "var(--text-primary)" },
  closeBtn: { fontSize: "1.25rem", color: "var(--text-tertiary)", cursor: "pointer", lineHeight: 1, padding: "2px 6px", borderRadius: "var(--radius-sm)" },
  tabs: { display: "flex", borderBottom: "0.5px solid var(--border)", flexShrink: 0 },
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
  tabActive: { color: "var(--accent)", borderBottom: "2px solid var(--accent)" },
  body: { overflowY: "auto", padding: "12px", flex: 1 },
  emptyState: { fontSize: "0.875rem", color: "var(--text-tertiary)", textAlign: "center", padding: "12px 8px" },
  errorText: { fontSize: "0.8125rem", color: "#dc2626" },
  retryLink: { fontSize: "0.8125rem", fontWeight: "500", color: "var(--accent)", cursor: "pointer", marginTop: "8px" },
  fileList: { display: "flex", flexDirection: "column", gap: "4px" },
  fileRow: { display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "var(--radius-md)" },
  fileIcon: { fontSize: "1.125rem", flexShrink: 0 },
  fileInfo: { flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  driveFileName: { fontSize: "0.875rem", fontWeight: "500", color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileMeta: { fontSize: "0.75rem", color: "var(--text-tertiary)" },
  attachBtn: { fontSize: "0.8125rem", fontWeight: "500", padding: "4px 10px", backgroundColor: "var(--accent)", color: "#fff", borderRadius: "var(--radius-md)", cursor: "pointer", flexShrink: 0 },
  attachedBadge: { fontSize: "0.75rem", color: "var(--text-tertiary)", padding: "4px 8px", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", flexShrink: 0 },
  uploadForm: { display: "flex", flexDirection: "column", gap: "12px" },
  typeRow: { display: "flex", gap: "8px" },
  typeOption: { flex: 1, padding: "8px 4px", fontSize: "0.8125rem", fontWeight: "500", color: "var(--text-secondary)", backgroundColor: "var(--bg-secondary)", borderRadius: "var(--radius-md)", border: "0.5px solid var(--border)", cursor: "pointer" },
  typeOptionSelected: { color: "var(--accent)", borderColor: "var(--accent)", backgroundColor: "rgba(15,110,86,0.06)" },
  input: { width: "100%", padding: "9px 12px", fontSize: "0.875rem", color: "var(--text-primary)", backgroundColor: "var(--bg-secondary)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", outline: "none", fontFamily: "inherit" },
  textarea: { width: "100%", padding: "9px 12px", fontSize: "0.875rem", color: "var(--text-primary)", backgroundColor: "var(--bg-secondary)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", outline: "none", fontFamily: "inherit", resize: "vertical" },
  createBtn: { width: "100%", padding: "10px", fontSize: "0.875rem", fontWeight: "500", color: "#fff", backgroundColor: "var(--accent)", borderRadius: "var(--radius-md)", cursor: "pointer" },
  createBtnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  userPickerRow: { display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: "10px 12px", borderRadius: "var(--radius-md)", cursor: "pointer", textAlign: "left", backgroundColor: "transparent" },
  userPickerAvatar: { width: "28px", height: "28px", borderRadius: "var(--radius-full)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: "500", color: "#fff", flexShrink: 0 },
  userPickerName: { fontSize: "0.875rem", fontWeight: "500", color: "var(--text-primary)" },
};
