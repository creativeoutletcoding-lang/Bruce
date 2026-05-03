"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useChatContext } from "@/components/layout/ChatShell";
import WelcomeScreen from "./WelcomeScreen";
import TopBar from "./TopBar";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import type { FileAttachment } from "./MessageInput";
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
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachedFile, setAttachedFile] = useState<FileAttachment | null>(null);

  function handleSuggestion(text: string) {
    setInput(text);
  }

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if ((!text && !attachedFile) || isStreaming) return;

    const fileToSend = attachedFile;
    setInput("");
    setAttachedFile(null);
    setError(null);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;

    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
      imageUrl: fileToSend?.type === "image" ? fileToSend.previewUrl : undefined,
      attachmentType: fileToSend?.type,
      attachmentFilename: fileToSend?.filename,
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
      if (fileToSend?.type === "image") {
        console.log("[NewChatOrchestrator] sending image: mediaType=%s base64Length=%d", fileToSend.mediaType, fileToSend.base64.length);
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId: null,
          isIncognito: incognito,
          image: fileToSend?.type === "image" ? { base64: fileToSend.base64, mediaType: fileToSend.mediaType } : undefined,
          document: fileToSend?.type === "document" ? { base64: fileToSend.base64, mediaType: fileToSend.mediaType, filename: fileToSend.filename } : undefined,
        }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const newChatId = res.headers.get("X-Chat-Id");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      const STATUS_RE = /\x1eSTATUS:[^\x1e]*\x1e/g;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        const statusMatch = /\x1eSTATUS:([^\x1e]*)\x1e/.exec(accumulated);
        if (statusMatch) setWorkingStatus(statusMatch[1]);

        const sentinelIdx = accumulated.indexOf("\x1f");
        const displayText = (sentinelIdx !== -1 ? accumulated.slice(0, sentinelIdx) : accumulated)
          .replace(STATUS_RE, "")
          .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
          .trimStart();
        if (displayText.trim()) setWorkingStatus(null);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId ? { ...m, content: displayText } : m
          )
        );
      }

      setWorkingStatus(null);

      // Parse sentinel
      const sentinelParts = accumulated.split("\x1f");
      const imageReqSentinel = sentinelParts.find((p) => p.startsWith("IMAGE_REQ:"));
      const finalText = sentinelParts[0]
        .replace(STATUS_RE, "")
        .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
        .trim();

      // Finalize stream placeholder
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

      // If image requested, await generation before navigating so ChatWindow
      // loads with the image already persisted in the DB
      if (!incognito && newChatId && imageReqSentinel) {
        try {
          const reqData = JSON.parse(imageReqSentinel.slice("IMAGE_REQ:".length)) as {
            prompt: string;
            quality: string;
            chatId: string;
          };
          const skeletonId = `skeleton-${Date.now()}`;
          setMessages((prev) => [
            ...prev,
            {
              id: skeletonId,
              role: "assistant" as const,
              content: "",
              created_at: new Date().toISOString(),
              metadata: { content_type: "image", image_url: "", prompt: reqData.prompt, quality: reqData.quality },
            },
          ]);
          await fetch("/api/images/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: reqData.prompt, chatId: reqData.chatId, quality: reqData.quality }),
          });
        } catch {
          // swallow — navigate regardless, ChatWindow loads whatever is in DB
        }
      }

      // Navigate after image (if any) has been persisted
      if (!incognito && newChatId) {
        refreshChats();
        router.push(`/chat/${newChatId}`);
      }
    } catch (err) {
      console.error("[NewChatOrchestrator] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
    }
  }, [input, attachedFile, isStreaming, incognito, router, refreshChats]);

  // Show welcome screen until the user sends their first message
  if (messages.length === 0) {
    return (
      <div style={styles.container}>
        <TopBar title="New Chat" hasMessages={false} />
        <WelcomeScreen userName={userName} onSuggestion={handleSuggestion} />
        <MessageInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={isStreaming}
          attachedFile={attachedFile}
          onFileAttach={(f) => setAttachedFile(f)}
          onFileClear={() => setAttachedFile(null)}
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

      <MessageList messages={messages} streamingStatus={workingStatus} />

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
        attachedFile={attachedFile}
        onFileAttach={(f) => setAttachedFile(f)}
        onFileClear={() => setAttachedFile(null)}
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
