"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useChatContext } from "@/components/layout/ChatShell";
import TopBar from "./TopBar";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import type { FileAttachment } from "./MessageInput";
import type { ChatMessage } from "./MessageList";
import type { Message, MessageRole } from "@/lib/types";
import { modelLabel } from "@/lib/models";

interface ChatWindowProps {
  chatId: string;
  initialMessages: Message[];
  initialTitle: string;
  userColorHex?: string;
  initialModel?: string;
}

export default function ChatWindow({
  chatId,
  initialMessages,
  initialTitle,
  userColorHex,
  initialModel,
}: ChatWindowProps) {
  const { incognito } = useChatContext();
  const [isClient, setIsClient] = useState(() => typeof window !== "undefined");
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      metadata: (m.metadata as Record<string, unknown>) ?? undefined,
      imageUrl: (m.image_url as string | undefined) ?? undefined,
      attachmentType: (m.attachment_type as string | undefined) ?? undefined,
      attachmentFilename: (m.attachment_filename as string | undefined) ?? undefined,
    }))
  );
  const [title, setTitle] = useState(initialTitle);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<string | undefined>(undefined);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [model, setModel] = useState(initialModel ?? "claude-sonnet-4-6");
  const memoryFiredRef = useRef(false);
  const messagesRef = useRef(messages);
  const incognitoRef = useRef(incognito);

  const loadMessages = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, created_at, metadata, image_url, attachment_type, attachment_filename")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (!data) return;
    setMessages(
      (data as Array<{ id: string; role: string; content: string; created_at: string; metadata: Record<string, unknown> | null; image_url?: string | null; attachment_type?: string | null; attachment_filename?: string | null }>).map(
        (m) => ({
          id: m.id,
          role: m.role as MessageRole,
          content: m.content,
          created_at: m.created_at,
          metadata: m.metadata ?? undefined,
          imageUrl: m.image_url ?? undefined,
          attachmentType: m.attachment_type ?? undefined,
          attachmentFilename: m.attachment_filename ?? undefined,
        })
      )
    );
  }, [chatId]);

  useEffect(() => { setIsClient(true); }, []);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { incognitoRef.current = incognito; }, [incognito]);

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
        } catch (err) { console.error('[geolocation]', err); }
      },
      () => { /* permission denied — silent */ },
      { timeout: 5000 }
    );
  }, []);

  // Fire memory generation on unmount only (empty deps)
  useEffect(() => {
    return () => {
      if (
        !incognitoRef.current &&
        !memoryFiredRef.current &&
        messagesRef.current.length >= 2
      ) {
        memoryFiredRef.current = true;
        fetch("/api/memory/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function handleSend() {
    const text = input.trim();
    if ((!text && !attachedFiles.length) || isStreaming) return;

    const filesToSend = attachedFiles;
    setInput("");
    setAttachedFiles([]);
    setError(null);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;

    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
      attachments: filesToSend.length > 0
        ? filesToSend.map((f) => ({ url: f.previewUrl ?? "", type: f.type, filename: f.filename }))
        : undefined,
    };
    const streamMsg: ChatMessage = {
      id: streamMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, streamMsg]);
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId,
          isIncognito: incognito,
          currentLocation,
          userTimestamp: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
          attachments: filesToSend.length > 0
            ? filesToSend.map((f) => ({ base64: f.base64, mediaType: f.mediaType, filename: f.filename, type: f.type }))
            : undefined,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("[ChatWindow] request failed: status=%d body=%s", res.status, errText);
        throw new Error(`Request failed: ${res.status}`);
      }

      const newChatId = res.headers.get("X-Chat-Id");
      const newTitle = res.headers.get("X-Chat-Title");

      if (newChatId && newChatId !== chatId) {
        // This shouldn't happen since chatId is fixed for this window, but guard anyway
      }

      if (newTitle) {
        setTitle(decodeURIComponent(newTitle));
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let sentinelSeen = false;
      const STATUS_RE = /\x1eSTATUS:[^\x1e]*\x1e/g;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        // Parse status sentinel — update indicator, never show in bubble
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
            prev.map((m) =>
              m.id === streamMsgId ? { ...m, content: display } : m
            )
          );
        }
      }

      setWorkingStatus(null);

      // Parse sentinel
      const sentinelParts = accumulated.split("\x1f");
      const imageReqSentinel = sentinelParts.find((p) => p.startsWith("IMAGE_REQ:"));

      const finalText = sentinelParts[0]
        .replace(STATUS_RE, "")
        .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
        .trim();

      // Fire image generation — image appears first, text after
      if (imageReqSentinel && !incognito && isClient) {
        try {
          const reqData = JSON.parse(imageReqSentinel.slice("IMAGE_REQ:".length)) as {
            prompt: string;
            quality: string;
            chatId: string;
          };
          const skeletonId = `skeleton-${Date.now()}`;
          // Atomic: remove stream placeholder, insert skeleton first, text below
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
          const imgBody = await imgRes.text();
          if (imgRes.ok) {
            const imgData = JSON.parse(imgBody) as {
              messageId: string;
              url: string;
              prompt: string;
              model: string;
              quality: string;
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
        // No image — finalize text bubble
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
      console.error("[ChatWindow] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) =>
        prev.filter((m) => m.id !== streamMsgId)
      );
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
    }
  }

  function handleRetry() {
    setError(null);
    // Re-send the last user message
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      setMessages((prev) => prev.filter((m) => m.id !== lastUser.id));
    }
  }

  return (
    <div
      style={{
        ...styles.container,
        ...(incognito ? styles.incognitoFilter : {}),
      }}
    >
      <TopBar title={title || "New Chat"} hasMessages={messages.length > 0} onRefresh={loadMessages} model={model} onModelChange={handleModelChange} />

      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}

      <MessageList messages={messages} onRefresh={loadMessages} userColorHex={userColorHex} streamingStatus={workingStatus} />

      {error && (
        <div style={styles.errorRow}>
          <span style={styles.errorText}>{error}</span>
          <button onClick={handleRetry} style={styles.retryButton}>
            Retry
          </button>
        </div>
      )}

      <MessageInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        disabled={isStreaming}
        attachedFiles={attachedFiles}
        onFilesAttach={(files) => setAttachedFiles((prev) => [...prev, ...files])}
        onFileRemove={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
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
  },
  incognitoFilter: {
    filter: "saturate(0.15)",
  },
  incognitoNotice: {
    padding: "6px 16px",
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    borderBottom: "1px solid var(--border)",
    textAlign: "center",
    flexShrink: 0,
  },
  errorRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "8px 16px",
    flexShrink: 0,
  },
  errorText: {
    fontSize: "0.8125rem",
    color: "var(--text-secondary)",
  },
  retryButton: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--accent)",
    cursor: "pointer",
  },
};
