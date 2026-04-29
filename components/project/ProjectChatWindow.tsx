"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ProjectTopBar from "./ProjectTopBar";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import type { ChatMessage } from "@/components/chat/MessageList";
import type { Message } from "@/lib/types";

interface ProjectChatWindowProps {
  chatId: string;
  projectId: string;
  projectName: string;
  projectIcon: string;
  initialMessages: Message[];
  initialTitle: string;
  initialInput?: string;
}

export default function ProjectChatWindow({
  chatId,
  projectId,
  projectName,
  projectIcon,
  initialMessages,
  initialInput,
}: ProjectChatWindowProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    }))
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instructionsFiredRef = useRef(false);
  const messagesRef = useRef(messages);
  const initialSentRef = useRef(false);

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

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setMessages((prev) =>
          prev.map((m) => (m.id === streamMsgId ? { ...m, content: current } : m))
        );
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamMsgId
            ? { ...m, isStreaming: false, created_at: new Date().toISOString() }
            : m
        )
      );
    } catch (err) {
      console.error("[ProjectChatWindow] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
    } finally {
      setIsStreaming(false);
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

      <MessageList messages={messages} />

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
};
