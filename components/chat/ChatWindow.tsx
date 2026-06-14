"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { parsePastedAttachments } from "@/lib/chat/pastedText";
import type { PastedAttachmentData } from "@/lib/chat/types";
import { createClient } from "@/lib/supabase/client";
import { useChatContext } from "@/components/layout/ChatShell";
import TopBar from "./TopBar";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import ModelPicker from "@/components/ui/ModelPicker";
import type { FileAttachment } from "./MessageInput";
import type { ChatMessage, MessageAttachment, NormalizedMessage } from "@/lib/chat/types";
import type { MessageRole, MovableProject } from "@/lib/types";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import { modelLabel } from "@/lib/models";
import {
  consumeStream,
  extractImageRequest,
  finalizeStream,
  resolveAbandonedTaskSteps,
} from "@/lib/chat/clientStream";
import { useChatMemory } from "@/lib/chat/useChatMemory";
import { useChatReactions } from "@/hooks/useChatReactions";
import { useChatSession } from "@/hooks/useChatSession";
import { useBrowserPanel } from "@/hooks/useBrowserPanel";
import BrowserPanel from "@/components/browser/BrowserPanel";

type ReactionRow = { message_id: string; user_id: string | null; type: string };

interface ChatWindowProps {
  chatId: string;
  initialMessages: NormalizedMessage[];
  initialTitle: string;
  userColorHex?: string;
  initialModel?: string;
  currentUserId?: string;
  initialReactions?: ReactionRow[];
  /** True when this is a standalone private chat owned by the viewer — gates "Move to project". */
  canMoveToProject?: boolean;
}

function toChatMessage(n: NormalizedMessage): ChatMessage {
  return {
    id: n.id,
    role: n.role,
    content: n.content,
    created_at: n.created_at,
    metadata: n.metadata ?? undefined,
    imageUrl: n.image_url ?? undefined,
    attachmentType: n.attachment_type ?? undefined,
    attachmentFilename: n.attachment_filename ?? undefined,
    sender_id: n.sender_id ?? undefined,
    pastedAttachments: (n.metadata?.pastedAttachments as PastedAttachmentData[] | undefined),
  };
}

export default function ChatWindow({
  chatId,
  initialMessages,
  initialTitle,
  userColorHex,
  initialModel,
  currentUserId,
  initialReactions,
  canMoveToProject = false,
}: ChatWindowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { incognito, refreshChats } = useChatContext();
  const [isClient, setIsClient] = useState(() => typeof window !== "undefined");
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((n) => toChatMessage(n))
  );
  const [title, setTitle] = useState(initialTitle);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [model, setModel] = useState(initialModel ?? "claude-sonnet-4-6");
  const abortRef = useRef<AbortController | null>(null);
  const pendingBlobAttachmentsRef = useRef<MessageAttachment[]>([]);

  useChatMemory({ chatId, messageCount: messages.length, disabled: incognito });

  // Standalone chat is one member + Bruce, so the only member color is the user's.
  const colorMap: Record<string, string | undefined> = currentUserId ? { [currentUserId]: userColorHex } : {};
  const { reactionsMap, loadReactions, handleReact } = useChatReactions({
    chatId, currentUserId, userColorHex, colorMap, initialReactions,
  });
  const { currentLocation, deleteMessage, handleRetry } = useChatSession({
    chatId, currentUserId, messages, setMessages, setInput, setError,
  });

  // Shared inline browser — not available in incognito chats.
  const browserEnabled = !incognito;
  const { panel: browserPanel, opening: browserOpening, openBrowser, toggleBrowser, closeBrowser, applyBrowserEvent } =
    useBrowserPanel(chatId, browserEnabled);

  // ── Move to project ──────────────────────────────────────────────────────
  // Once moved, projectContext is set and the topbar shows a breadcrumb; the
  // "Move to project" menu item disappears (the chat is no longer standalone).
  const [projectContext, setProjectContext] = useState<{ id: string; name: string } | null>(null);
  const [movableProjects, setMovableProjects] = useState<MovableProject[]>([]);
  const [movableLoading, setMovableLoading] = useState(false);
  const moveEligible = canMoveToProject && !incognito && !projectContext;

  useEffect(() => {
    if (!moveEligible) return;
    let cancelled = false;
    setMovableLoading(true);
    fetch("/api/projects/movable")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: MovableProject[]) => { if (!cancelled) setMovableProjects(data); })
      .catch(() => { if (!cancelled) setMovableProjects([]); })
      .finally(() => { if (!cancelled) setMovableLoading(false); });
    return () => { cancelled = true; };
  }, [moveEligible]);

  const handleMoveToProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        console.error("[ChatWindow] move failed: status=%d", res.status);
        return;
      }
      const data = await res.json() as { project_id: string; project_name: string };
      setProjectContext({ id: data.project_id, name: data.project_name });
      refreshChats(); // drop the chat from the standalone sidebar list immediately
    } catch (err) {
      console.error("[ChatWindow] move error:", err);
    }
  }, [chatId, refreshChats]);

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
      (data as Array<Record<string, unknown>>).map((row) => toChatMessage(normalizeMessage(row)))
    );
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    await loadReactions(ids);
  }, [chatId, loadReactions]);

  useEffect(() => { setIsClient(true); }, []);

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

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !attachedFiles.length) || isStreaming) return;

    const filesToSend = attachedFiles;
    // Capture blob URLs before clearing — used as fallback if storage upload fails
    pendingBlobAttachmentsRef.current = filesToSend
      .filter((f) => f.previewUrl)
      .map((f) => ({ url: f.previewUrl!, type: f.type, filename: f.filename }));
    setInput("");
    setAttachedFiles([]);
    setError(null);
    router.replace(pathname);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;

    const { displayMessage: displayText, pastedAttachments: msgPastedAttachments } = parsePastedAttachments(text);
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: displayText,
      created_at: new Date().toISOString(),
      sender_id: currentUserId,
      attachments: filesToSend.length > 0
        ? filesToSend.map((f) => ({ url: f.previewUrl ?? "", type: f.type, filename: f.filename }))
        : undefined,
      pastedAttachments: msgPastedAttachments.length > 0 ? msgPastedAttachments : undefined,
    };
    const streamMsg: ChatMessage = {
      id: streamMsgId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, streamMsg]);
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
                  body: JSON.stringify({ base64: f.base64, mediaType: f.mediaType, filename: f.filename, type: f.type, isIncognito: incognito }),
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

      setWorkingStatus("Thinking…");
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId,
          isIncognito: incognito,
          currentLocation,
          userTimestamp: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
          attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined,
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("[ChatWindow] request failed: status=%d body=%s", res.status, errText);
        throw new Error(`Request failed: ${res.status}`);
      }

      const newTitle = res.headers.get("X-Chat-Title");
      if (newTitle) setTitle(decodeURIComponent(newTitle));

      let hasFirstContent = false;

      const { accumulated, aborted } = await consumeStream({
        response: res,
        signal: abort.signal,
        onTick: ({ display, task, workingStatus: ws, browserEvent }) => {
          if (!hasFirstContent && (display.trim() || task)) {
            hasFirstContent = true;
            setWorkingStatus(null);
          }
          if (ws !== null) setWorkingStatus(ws);
          if (browserEvent) applyBrowserEvent(browserEvent);
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

      const imageReq = !aborted ? extractImageRequest(accumulated) : null;

      if (imageReq && !incognito && isClient) {
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
        // Stop pressed — keep whatever text is in the optimistic message.
        setMessages((prev) =>
          prev.map((m) => m.id === streamMsgId ? { ...m, isStreaming: false, interrupted: true } : m)
        );
      } else {
        console.error("[ChatWindow] handleSend failed:", err);
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(`${errMsg} — tap to retry`);
        setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
      }
    } finally {
      setIsStreaming(false);
      setWorkingStatus(null);
      abortRef.current = null;
      // Skip loadMessages on abort: the optimistic message already shows the
      // partial content. The server persists it asynchronously; the next send
      // will load fresh state from DB.
      if (!incognito && !abort.signal.aborted) {
        await loadMessages();
        // If storage upload failed, the DB message has an empty image URL.
        // Fall back to the captured blob URL so the image stays visible.
        const blobs = pendingBlobAttachmentsRef.current;
        if (blobs.length > 0) {
          pendingBlobAttachmentsRef.current = [];
          setMessages((prev) => {
            const lastUserIdx = prev.reduce((acc, m, i) => m.role === "user" ? i : acc, -1);
            if (lastUserIdx === -1) return prev;
            const msg = prev[lastUserIdx];
            const metaAtts = msg.metadata?.attachments as MessageAttachment[] | undefined;
            const hasRealUrl =
              (msg.imageUrl && msg.imageUrl.length > 0) ||
              metaAtts?.some((a) => a.url && a.url.length > 0);
            if (hasRealUrl) return prev;
            return prev.map((m, i) => (i === lastUserIdx ? { ...m, attachments: blobs } : m));
          });
        }
      }
    }
  }

  const browserPanelEl = browserPanel.sessionId && browserPanel.liveViewUrl ? (
    <BrowserPanel
      chatId={chatId}
      sessionId={browserPanel.sessionId}
      liveViewUrl={browserPanel.liveViewUrl}
      initialUrl={browserPanel.currentUrl ?? undefined}
      onClose={closeBrowser}
    />
  ) : null;

  return (
    <div
      style={{
        ...styles.container,
        ...(incognito ? styles.incognitoFilter : {}),
      }}
    >
      <TopBar title={title || "New Chat"} hasMessages={messages.length > 0} projectName={projectContext?.name} />

      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}

      <MessageList messages={messages} onRefresh={loadMessages} userColorHex={userColorHex} streamingStatus={workingStatus} currentUserId={currentUserId} onDeleteMessage={deleteMessage} reactionsMap={reactionsMap} onReact={handleReact} inlineCard={browserPanel.open ? browserPanelEl : null} />

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
        onStop={handleStop}
        isStreaming={isStreaming}
        attachedFiles={attachedFiles}
        onFilesAttach={(files) => setAttachedFiles((prev) => [...prev, ...files])}
        onFileRemove={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
        moveToProject={
          moveEligible
            ? { projects: movableProjects, onSelect: handleMoveToProject, loading: movableLoading }
            : undefined
        }
        onBrowserClick={
          browserEnabled
            ? () => (browserPanel.sessionId ? toggleBrowser() : openBrowser())
            : undefined
        }
        browserActive={browserPanel.open}
        browserOpening={browserOpening}
        modelPicker={<ModelPicker currentModel={model} onSelect={handleModelChange} />}
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
