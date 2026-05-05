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

  const messagesRef = useRef(messages);
  const instructionsFiredRef = useRef(false);
  const initialSentRef = useRef(false);

  useEffect(() => { setIsClient(true); }, []);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

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
            // When Bruce's real DB message arrives, replace the optimistic streaming placeholder
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

  useEffect(() => {
    if (initialInput && !initialSentRef.current) {
      initialSentRef.current = true;
      sendMessage(initialInput, undefined);
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
          senderName: senderInfo?.name,
          senderColorHex: senderInfo?.color_hex,
        };
      })
    );
  }, [chatId]);

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
          userTimestamp: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
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
      console.error("[ProjectChatView] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
      // Don't refetch from DB here — it races with the server's insert and causes
      // the streamed message to flash and disappear. The realtime listener replaces
      // the optimistic placeholder (tmp-stream-*) when the real DB row arrives.
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
