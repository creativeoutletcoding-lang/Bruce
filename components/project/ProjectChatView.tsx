"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import ProjectTopBar from "./ProjectTopBar";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import type { FileAttachment } from "@/components/chat/MessageInput";
import type { ChatMessage } from "@/components/chat/MessageList";
import type {
  Message,
  MessageRole,
  ProjectMemberDetail,
} from "@/lib/types";
import {
  consumeStream,
  extractImageRequest,
  resolveAbandonedTaskSteps,
} from "@/lib/chat/clientStream";
import { useChatMemory } from "@/lib/chat/useChatMemory";
import { getDisplayName } from "@/lib/chat/senderProfile";

interface ProjectChatViewProps {
  chatId: string;
  projectId: string;
  projectName: string;
  projectIcon: string;
  initialMessages: Message[];
  initialInput?: string;
  userColorHex?: string;
  currentUserId: string;
  members: ProjectMemberDetail[];
}

export default function ProjectChatView({
  chatId,
  projectId,
  projectName,
  projectIcon,
  initialMessages,
  initialInput,
  userColorHex,
  currentUserId,
  members,
}: ProjectChatViewProps) {
  const memberMapRef = useRef<Record<string, { name: string; color_hex: string }>>(
    Object.fromEntries(members.map((m) => [m.id, { name: m.name, color_hex: m.color_hex }]))
  );
  const isStreamingRef = useRef(false);

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
        senderName: senderInfo ? getDisplayName(senderInfo.name) : undefined,
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
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const key = `bruce_project_initial_files_${chatId}`;
      const stored = sessionStorage.getItem(key);
      if (stored) {
        sessionStorage.removeItem(key);
        return JSON.parse(stored) as FileAttachment[];
      }
    } catch { /* sessionStorage unavailable */ }
    return [];
  });

  const instructionsFiredRef = useRef(false);
  const initialSentRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useChatMemory({ chatId, messageCount: messages.length });

  useEffect(() => { setIsClient(true); }, []);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  // Instruction-update fire-and-forget on unmount, parallel to memory generation.
  const messagesLenRef = useRef(messages.length);
  useEffect(() => { messagesLenRef.current = messages.length; }, [messages.length]);
  useEffect(() => {
    return () => {
      if (!instructionsFiredRef.current && messagesLenRef.current >= 2) {
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

  // Mark chat as read on open.
  useEffect(() => {
    fetch("/api/chats/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
      keepalive: true,
    }).catch(() => {});
  }, [chatId]);

  useEffect(() => {
    const supabase = createClient();
    const topic = `project-chat-${chatId}`;
    const existing = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (existing) supabase.removeChannel(existing);

    const channel = supabase
      .channel(topic)
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
            const base = msg.sender_id === null
              ? prev.filter((m) => !m.id.startsWith("tmp-stream-"))
              : prev;
            return [
              ...base,
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
                senderName: senderInfo ? getDisplayName(senderInfo.name) : undefined,
                senderColorHex: senderInfo?.color_hex,
              },
            ];
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId, currentUserId]);

  useEffect(() => {
    const hasInitialFiles = attachedFiles.length > 0;
    if ((initialInput || hasInitialFiles) && !initialSentRef.current) {
      initialSentRef.current = true;
      sendMessage(initialInput ?? "", hasInitialFiles ? attachedFiles : undefined);
      if (hasInitialFiles) setAttachedFiles([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          senderName: senderInfo ? getDisplayName(senderInfo.name) : undefined,
          senderColorHex: senderInfo?.color_hex,
        };
      })
    );
  }, [chatId]);

  function handleStop() {
    abortRef.current?.abort();
  }

  async function sendMessage(text: string, filesOverride?: FileAttachment[] | null) {
    const filesToSend = filesOverride !== undefined ? (filesOverride ?? []) : attachedFiles;
    if ((!text && !filesToSend.length) || isStreaming) return;

    setInput("");
    setAttachedFiles([]);
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
        attachments: filesToSend.length > 0
          ? filesToSend.map((f) => ({ url: f.previewUrl ?? "", type: f.type, filename: f.filename }))
          : undefined,
        sender_id: currentUserId,
      },
      { id: streamMsgId, role: "assistant", content: "", isStreaming: true },
    ]);
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const uploadedAttachments = filesToSend.length > 0
        ? await Promise.all(
            filesToSend.map(async (f) => {
              try {
                const upRes = await fetch("/api/files/upload", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ base64: f.base64, mediaType: f.mediaType, filename: f.filename, type: f.type, isIncognito: false }),
                });
                if (upRes.ok) {
                  const data = await upRes.json() as { file_id: string | null; url: string };
                  return { file_id: data.file_id, url: data.url, type: f.type, filename: f.filename };
                }
              } catch { /* silent */ }
              return { file_id: null, url: "", type: f.type, filename: f.filename };
            })
          )
        : [];

      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId,
          currentLocation,
          userTimestamp: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
        }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      let hasFirstContent = false;

      const { accumulated, aborted } = await consumeStream({
        response: res,
        signal: abort.signal,
        onTick: ({ display, task, workingStatus: ws }) => {
          if (!hasFirstContent && (display.trim() || task)) {
            hasFirstContent = true;
            setWorkingStatus(null);
          }
          if (ws !== null) setWorkingStatus(ws);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamMsgId
                ? { ...m, content: display, ...(task !== null ? { taskData: task } : {}) }
                : m
            )
          );
        },
      });

      setWorkingStatus(null);

      const idx = accumulated.indexOf("\x1f");
      const raw = idx !== -1 ? accumulated.slice(0, idx) : accumulated;
      const finalText = raw
        .replace(/\x1eSTATUS:[^\x1e]*\x1e/g, "")
        .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
        .replace(/<task_progress>[\s\S]*?<\/task_progress>/g, "")
        .replace(/<task_progress>[\s\S]*/g, "")
        .trim();

      let finalTask = null as ReturnType<typeof resolveAbandonedTaskSteps> | null;
      {
        const re = /<task_progress>([\s\S]*?)<\/task_progress>/g;
        let m: RegExpExecArray | null;
        let latest = null;
        while ((m = re.exec(raw)) !== null) {
          try { latest = JSON.parse(m[1]); } catch { /* skip */ }
        }
        finalTask = latest;
      }

      const imageReq = !aborted ? extractImageRequest(accumulated) : null;

      if (imageReq && isClient) {
        try {
          const skeletonId = `skeleton-${Date.now()}`;
          setMessages((prev) => {
            const withoutStream = prev.filter((m) => m.id !== streamMsgId);
            const skeleton: ChatMessage = {
              id: skeletonId,
              role: "assistant",
              content: "",
              created_at: new Date().toISOString(),
              metadata: { content_type: "image", image_url: "", prompt: imageReq.prompt, quality: imageReq.quality },
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
            body: JSON.stringify({ prompt: imageReq.prompt, chatId: imageReq.chatId, quality: imageReq.quality }),
          });
          if (imgRes.ok) {
            const imgData = await imgRes.json() as { messageId: string; url: string; prompt: string; model: string; quality: string };
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
      } else if (finalTask) {
        const resolvedTask = resolveAbandonedTaskSteps(finalTask, aborted ? "interrupted" : "incomplete");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? { ...m, content: finalText, isStreaming: false, taskData: resolvedTask, ...(aborted ? { interrupted: true } : {}), created_at: new Date().toISOString() }
              : m
          )
        );
      } else if (finalText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? { ...m, content: finalText, isStreaming: false, ...(aborted ? { interrupted: true } : {}), created_at: new Date().toISOString() }
              : m
          )
        );
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
      }
    } catch (err) {
      if (abort.signal.aborted) {
        setMessages((prev) =>
          prev.map((m) => m.id === streamMsgId ? { ...m, isStreaming: false, interrupted: true } : m)
        );
      } else {
        console.error("[ProjectChatView] sendMessage failed:", err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(`${errMsg} — tap to retry`);
        setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
      }
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
      abortRef.current = null;
      if (!abort.signal.aborted) {
        await loadMessages();
      }
    }
  }

  function handleSend() { sendMessage(input.trim()); }

  async function deleteMessage(msgId: string) {
    if (msgId.startsWith("tmp-")) return;
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    const supabase = createClient();
    const { error } = await supabase.from("messages").delete().eq("id", msgId);
    if (error) console.error("[ProjectChatView] deleteMessage failed:", error);
  }

  function handleRetry() {
    setError(null);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      setMessages((prev) => prev.filter((m) => m.id !== lastUser.id));
    }
  }

  return (
    <div style={styles.container}>
      <ProjectTopBar
        projectId={projectId}
        projectName={projectName}
        projectIcon={projectIcon}
        members={members}
      />

      <MessageList
        messages={messages}
        onRefresh={loadMessages}
        userColorHex={userColorHex}
        streamingStatus={workingStatus}
        currentUserId={currentUserId}
        onDeleteMessage={deleteMessage}
        groupContext={members.length > 1}
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
        onStop={handleStop}
        isStreaming={isStreaming}
        attachedFiles={attachedFiles}
        onFilesAttach={(files) => setAttachedFiles((prev) => [...prev, ...files])}
        onFileRemove={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
        placeholder={`Message ${projectName}…`}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    backgroundColor: "var(--bg-primary)",
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
