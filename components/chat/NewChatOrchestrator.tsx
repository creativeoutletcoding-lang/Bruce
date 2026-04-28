"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useChatContext } from "@/components/layout/ChatShell";
import WelcomeScreen from "./WelcomeScreen";
import TopBar from "./TopBar";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import type { ChatMessage } from "./MessageList";

interface NewChatOrchestratorProps {
  userName: string;
  initialInput?: string;
}

export default function NewChatOrchestrator({
  userName,
  initialInput = "",
}: NewChatOrchestratorProps) {
  const router = useRouter();
  const { incognito, refreshChats } = useChatContext();
  const [input, setInput] = useState(initialInput);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSuggestion(text: string) {
    setInput(text);
  }

  const handleSend = useCallback(async () => {
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

    setMessages([userMsg, streamMsg]);
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, chatId: null, isIncognito: incognito }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const newChatId = res.headers.get("X-Chat-Id");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId ? { ...m, content: current } : m
          )
        );
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === streamMsgId
            ? { ...m, isStreaming: false, created_at: new Date().toISOString() }
            : m
        )
      );

      // For non-incognito: refresh sidebar while still on /chat, then navigate
      if (!incognito && newChatId) {
        refreshChats();
        console.log("[NewChatOrchestrator] navigating to", `/chat/${newChatId}`);
        router.push(`/chat/${newChatId}`);
        console.log("[NewChatOrchestrator] router.push called");
      }
    } catch (err) {
      console.error("[NewChatOrchestrator] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, incognito, router, refreshChats]);

  // Show welcome screen until the user sends their first message
  if (messages.length === 0) {
    return (
      <div style={styles.container}>
        <WelcomeScreen userName={userName} onSuggestion={handleSuggestion} />
        <MessageInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={isStreaming}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        ...styles.container,
        ...(incognito ? styles.incognitoFilter : {}),
      }}
    >
      <TopBar title="New Chat" hasMessages={messages.length > 0} />

      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}

      <MessageList messages={messages} />

      {error && (
        <div style={styles.errorRow}>
          <span style={styles.errorText}>{error}</span>
          <button
            onClick={() => {
              setError(null);
              const lastUser = [...messages].reverse().find((m) => m.role === "user");
              if (lastUser) {
                setInput(lastUser.content);
                setMessages((prev) => prev.filter((m) => m.id !== lastUser.id));
              }
            }}
            style={styles.retryButton}
          >
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
