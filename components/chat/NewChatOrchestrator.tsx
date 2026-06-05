"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChatContext } from "@/components/layout/ChatShell";
import WelcomeScreen from "./WelcomeScreen";
import TopBar from "./TopBar";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import type { FileAttachment } from "./MessageInput";
import type { ChatMessage } from "./MessageList";
import type { MovableProject } from "@/lib/types";
import { DEFAULT_MODEL } from "@/lib/models";
import {
  consumeStream,
  extractImageRequest,
  finalizeStream,
  resolveAbandonedTaskSteps,
} from "@/lib/chat/clientStream";

interface NewChatOrchestratorProps {
  userName: string;
  userColorHex?: string;
  initialInput?: string;
}

export default function NewChatOrchestrator({
  userName,
  userColorHex,
  initialInput = "",
}: NewChatOrchestratorProps) {
  const router = useRouter();
  const { incognito, refreshChats } = useChatContext();
  const [input, setInput] = useState(initialInput);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  // Initialize from DEFAULT_MODEL so server and client render the same HTML
  // (reading localStorage during useState init causes React hydration error #418
  // because the server always sees typeof window === "undefined").
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  useEffect(() => {
    const stored = localStorage.getItem("bruce:model");
    if (stored) setModel(stored);
  }, []);

  // Optional "add to project" via the + menu (welcome screen only).
  const [movableProjects, setMovableProjects] = useState<MovableProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null);

  const handleAssignProject = useCallback((projectId: string) => {
    const project = movableProjects.find((p) => p.id === projectId);
    if (project) setSelectedProject({ id: project.id, name: project.name });
  }, [movableProjects]);

  useEffect(() => {
    if (incognito) return;
    let cancelled = false;
    fetch("/api/projects/movable")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: MovableProject[]) => { if (!cancelled) setMovableProjects(data); })
      .catch(() => { if (!cancelled) setMovableProjects([]); });
    return () => { cancelled = true; };
  }, [incognito]);

  async function handleModelChange(id: string) {
    setModel(id);
    if (typeof window !== "undefined") localStorage.setItem("bruce:model", id);
    await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_model: id }),
    }).catch(() => {});
  }

  const handleSend = useCallback(async () => {
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

    setMessages([userMsg, streamMsg]);
    setIsStreaming(true);

    try {
      setWorkingStatus("Thinking…");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId: null,
          isIncognito: incognito,
          projectId: selectedProject?.id ?? null,
          userTimestamp: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
          attachments: filesToSend.length > 0
            ? filesToSend.map((f) => ({ base64: f.base64, mediaType: f.mediaType, filename: f.filename, type: f.type }))
            : undefined,
        }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const newChatId = res.headers.get("X-Chat-Id");

      const { accumulated } = await consumeStream({
        response: res,
        onTick: ({ display, task, workingStatus: ws }) => {
          if (ws !== null) setWorkingStatus(ws);
          if (display.trim()) setWorkingStatus(null);
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

      const { display: finalText, task: finalTask } = finalizeStream(accumulated);
      const imageReq = extractImageRequest(accumulated);

      // Finalize stream placeholder
      if (finalTask) {
        const resolved = resolveAbandonedTaskSteps(finalTask, "incomplete");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? { ...m, content: finalText, isStreaming: false, taskData: resolved, created_at: new Date().toISOString() }
              : m
          )
        );
      } else if (finalText) {
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
      if (!incognito && newChatId && imageReq) {
        try {
          const skeletonId = `skeleton-${Date.now()}`;
          setMessages((prev) => [
            ...prev,
            {
              id: skeletonId,
              role: "assistant" as const,
              content: "",
              created_at: new Date().toISOString(),
              metadata: { content_type: "image", image_url: "", prompt: imageReq.prompt, quality: imageReq.quality },
            },
          ]);
          await fetch("/api/images/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: imageReq.prompt, chatId: imageReq.chatId, quality: imageReq.quality }),
          });
        } catch {
          // swallow — navigate regardless, ChatWindow loads whatever is in DB
        }
      }

      // Navigate after image (if any) has been persisted. A project-assigned chat
      // lives at its project URL (mirrors a moved chat's canonical location).
      if (!incognito && newChatId) {
        refreshChats();
        if (selectedProject) {
          router.push(`/projects/${selectedProject.id}/chat/${newChatId}`);
        } else {
          router.push(`/chat/${newChatId}`);
        }
      }
    } catch (err) {
      console.error("[NewChatOrchestrator] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
    }
  }, [input, attachedFiles, isStreaming, incognito, router, refreshChats, selectedProject]);

  // Show welcome screen until the user sends their first message
  if (messages.length === 0) {
    return (
      <div style={styles.container}>
        <TopBar title="New Chat" hasMessages={false} projectName={selectedProject?.name ?? undefined} />
        <WelcomeScreen
          userName={userName}
          inputValue={input}
          onInputChange={setInput}
          onSend={handleSend}
          disabled={isStreaming}
          attachedFiles={attachedFiles}
          onFilesAttach={(files) => setAttachedFiles((prev) => [...prev, ...files])}
          onFileRemove={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
          model={model}
          onModelChange={handleModelChange}
          moveToProject={
            !incognito && movableProjects.length > 0
              ? { projects: movableProjects, onSelect: handleAssignProject, label: "Add to project" }
              : undefined
          }
          selectedProject={selectedProject}
          onClearProject={() => setSelectedProject(null)}
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
      <TopBar title="New Chat" hasMessages={messages.length > 0} projectName={selectedProject?.name} />

      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}

      <MessageList messages={messages} streamingStatus={workingStatus} userColorHex={userColorHex} />

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
