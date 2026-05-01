"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useChatContext } from "@/components/layout/ChatShell";
import TopBar from "./TopBar";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import type { ChatMessage } from "./MessageList";
import type { Message, MessageRole } from "@/lib/types";

interface ChatWindowProps {
  chatId: string;
  initialMessages: Message[];
  initialTitle: string;
}

export default function ChatWindow({
  chatId,
  initialMessages,
  initialTitle,
}: ChatWindowProps) {
  const { incognito } = useChatContext();
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      metadata: (m.metadata as Record<string, unknown>) ?? undefined,
    }))
  );
  const [title, setTitle] = useState(initialTitle);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memoryFiredRef = useRef(false);
  const messagesRef = useRef(messages);
  const incognitoRef = useRef(incognito);

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

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { incognitoRef.current = incognito; }, [incognito]);

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

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setError(null);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;

    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
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
        body: JSON.stringify({ message: text, chatId, isIncognito: incognito }),
      });

      if (!res.ok) {
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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        // Strip image tag from display; IMAGE_MSG sentinel lives after \x1f
        const textPart = accumulated.split("\x1f")[0];
        const display = textPart
          .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
          .trimStart();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId ? { ...m, content: display } : m
          )
        );
      }

      // Parse IMAGE_MSG sentinel
      const sentinelParts = accumulated.split("\x1f");
      const imageSentinel = sentinelParts.find((p) => p.startsWith("IMAGE_MSG:"));

      // Finalize streaming text message
      const finalText = sentinelParts[0]
        .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
        .trim();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamMsgId
            ? { ...m, content: finalText, isStreaming: false, created_at: new Date().toISOString() }
            : m
        )
      );

      // Append image message if present
      if (imageSentinel) {
        try {
          const imgData = JSON.parse(imageSentinel.slice("IMAGE_MSG:".length)) as {
            messageId: string;
            url: string;
            prompt: string;
            model: string;
          };
          setMessages((prev) => [
            ...prev,
            {
              id: imgData.messageId,
              role: "assistant" as const,
              content: `[Image: ${imgData.prompt.slice(0, 100)}]`,
              created_at: new Date().toISOString(),
              metadata: {
                content_type: "image",
                image_url: imgData.url,
                prompt: imgData.prompt,
                model: imgData.model,
              },
            },
          ]);
        } catch {
          // Malformed sentinel — ignore
        }
      }
    } catch (err) {
      console.error("[ChatWindow] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      // Remove the streaming placeholder on error
      setMessages((prev) =>
        prev.filter((m) => m.id !== streamMsgId)
      );
    } finally {
      setIsStreaming(false);
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
      <TopBar title={title || "New Chat"} hasMessages={messages.length > 0} onRefresh={loadMessages} />

      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}

      <MessageList messages={messages} onRefresh={loadMessages} />

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
