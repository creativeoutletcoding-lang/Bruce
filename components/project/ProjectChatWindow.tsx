"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ProjectTopBar from "./ProjectTopBar";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import type { ChatMessage } from "@/components/chat/MessageList";
import type { Message, MessageRole } from "@/lib/types";

interface ProjectChatWindowProps {
  chatId: string;
  projectId: string;
  projectName: string;
  projectIcon: string;
  initialMessages: Message[];
  initialTitle: string;
  initialInput?: string;
  userColorHex?: string;
}

export default function ProjectChatWindow({
  chatId,
  projectId,
  projectName,
  projectIcon,
  initialMessages,
  initialInput,
  userColorHex,
}: ProjectChatWindowProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      metadata: (m.metadata as Record<string, unknown>) ?? undefined,
    }))
  );
  const [isClient, setIsClient] = useState(() => typeof window !== "undefined");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const instructionsFiredRef = useRef(false);
  const messagesRef = useRef(messages);
  const initialSentRef = useRef(false);

  const loadMessages = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, created_at, metadata")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (!data) return;
    setMessages(
      (data as Array<{ id: string; role: string; content: string; created_at: string; metadata: Record<string, unknown> | null }>).map(
        (m) => ({
          id: m.id,
          role: m.role as MessageRole,
          content: m.content,
          created_at: m.created_at,
          metadata: m.metadata ?? undefined,
        })
      )
    );
  }, [chatId]);

  useEffect(() => { setIsClient(true); }, []);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Fire living instructions update on unmount
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

  // Auto-send the message passed from the project home inline input
  useEffect(() => {
    if (initialInput && !initialSentRef.current) {
      initialSentRef.current = true;
      // Clean the URL so refresh doesn't re-send
      router.replace(`/projects/${projectId}/chat/${chatId}`, { scroll: false });
      sendMessage(initialInput);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMessage(text: string) {
    if (!text || isStreaming) return;

    setInput("");
    setError(null);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: text, created_at: new Date().toISOString() },
      { id: streamMsgId, role: "assistant", content: "", isStreaming: true },
    ]);
    setIsStreaming(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, chatId }),
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
            prev.map((m) => (m.id === streamMsgId ? { ...m, content: display } : m))
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
      if (imageReqSentinel && isClient) {
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
      console.error("[ProjectChatWindow] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
    }
  }

  function handleSend() {
    sendMessage(input.trim());
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
      />

      <MessageList messages={messages} onRefresh={loadMessages} userColorHex={userColorHex} />

      {workingStatus && (
        <div style={styles.workingStatus}>{workingStatus}</div>
      )}

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
  workingStatus: {
    padding: "4px 16px 6px",
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    fontStyle: "italic",
    flexShrink: 0,
  },
};
