"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { parsePastedAttachments } from "@/lib/chat/pastedText";
import type { PastedAttachmentData } from "@/lib/chat/types";
import { createClient } from "@/lib/supabase/client";
import ProjectTopBar from "./ProjectTopBar";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import type { FileAttachment } from "@/components/chat/MessageInput";
import type { ChatMessage, MessageAttachment, NormalizedMessage } from "@/lib/chat/types";
import type { ProjectMemberDetail } from "@/lib/types";
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
import { getDisplayName } from "@/lib/chat/senderProfile";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";

type ReactionRow = { message_id: string; user_id: string | null; type: string };

interface ProjectChatViewProps {
  chatId: string;
  projectId: string;
  projectName: string;
  initialMessages: NormalizedMessage[];
  initialInput?: string;
  userColorHex?: string;
  currentUserId: string;
  members: ProjectMemberDetail[];
  initialReactions?: ReactionRow[];
}

function toChatMessage(
  n: NormalizedMessage,
  memberMap: Record<string, { name: string; color_hex: string }>
): ChatMessage {
  const senderInfo = n.sender_id ? memberMap[n.sender_id] : null;
  const metaAttachments = n.metadata?.attachments as MessageAttachment[] | undefined;
  const attachments = metaAttachments?.length
    ? metaAttachments
    : (n.image_url ? [{ url: n.image_url, type: n.attachment_type ?? "image", filename: n.attachment_filename ?? undefined }] : undefined);
  return {
    id: n.id,
    role: n.role,
    content: n.content,
    created_at: n.created_at,
    metadata: n.metadata ?? undefined,
    attachments,
    imageUrl: n.image_url ?? undefined,
    attachmentType: n.attachment_type ?? undefined,
    attachmentFilename: n.attachment_filename ?? undefined,
    sender_id: n.sender_id ?? undefined,
    senderName: senderInfo ? getDisplayName(senderInfo.name) : undefined,
    senderColorHex: senderInfo?.color_hex,
    pastedAttachments: (n.metadata?.pastedAttachments as PastedAttachmentData[] | undefined),
  };
}

export default function ProjectChatView({
  chatId,
  projectId,
  projectName,
  initialMessages,
  initialInput,
  userColorHex,
  currentUserId,
  members,
  initialReactions,
}: ProjectChatViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const memberMapRef = useRef<Record<string, { name: string; color_hex: string }>>(
    Object.fromEntries(members.map((m) => [m.id, { name: m.name, color_hex: m.color_hex }]))
  );
  const isStreamingRef = useRef(false);

  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((n) => toChatMessage(n, memberMapRef.current))
  );

  const [isClient, setIsClient] = useState(() => typeof window !== "undefined");
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const colorMap: Record<string, string | undefined> = Object.fromEntries(
    members.map((m) => [m.id, m.color_hex])
  );
  const { reactionsMap, setReactionsMap, loadReactions, handleReact } = useChatReactions({
    chatId, currentUserId, userColorHex, colorMap, initialReactions,
  });
  const { currentLocation, deleteMessage, handleRetry } = useChatSession({
    chatId, currentUserId, messages, setMessages, setInput, setError,
  });
  const { panel: browserPanel, opening: browserOpening, openBrowser, toggleBrowser, closeBrowser, applyBrowserEvent } =
    useBrowserPanel(chatId, true);

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
          const n = normalizeMessage(payload.new as Record<string, unknown>);
          if (n.sender_id === currentUserId) return;
          if (n.sender_id === null && isStreamingRef.current) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === n.id)) return prev;
            const base = n.sender_id === null
              ? prev.filter((m) => !m.id.startsWith("tmp-stream-"))
              : prev;
            return [...base, toChatMessage(n, memberMapRef.current)];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const row = payload.new as { message_id: string; user_id: string | null; type: string };
          const colorMap: Record<string, string | undefined> = Object.fromEntries(
            Object.entries(memberMapRef.current).map(([id, info]) => [id, info.color_hex])
          );
          setReactionsMap((prev) => {
            const entries = prev[row.message_id] ? [...prev[row.message_id]] : [];
            const idx = entries.findIndex((e) => e.type === row.type);
            const isCurrentUser = row.user_id === currentUserId;
            const reactor = { userId: row.user_id, colorHex: row.user_id ? colorMap[row.user_id] : "#0F6E56" };
            if (idx !== -1) {
              const entry = { ...entries[idx] };
              if (!entry.reactors.some((r) => r.userId === row.user_id)) {
                entry.count += 1;
                entry.reactors = [...entry.reactors, reactor];
                if (isCurrentUser) entry.hasCurrentUser = true;
                entries[idx] = entry;
              }
            } else {
              entries.push({ type: row.type, count: 1, reactors: [reactor], hasCurrentUser: isCurrentUser });
            }
            return { ...prev, [row.message_id]: entries };
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reactions", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const row = payload.old as { message_id: string; user_id: string | null; type: string };
          setReactionsMap((prev) => {
            const entries = prev[row.message_id] ? [...prev[row.message_id]] : [];
            const idx = entries.findIndex((e) => e.type === row.type);
            if (idx === -1) return prev;
            const entry = { ...entries[idx] };
            entry.reactors = entry.reactors.filter((r) => r.userId !== row.user_id);
            entry.count = Math.max(0, entry.count - 1);
            if (row.user_id === currentUserId) entry.hasCurrentUser = false;
            if (entry.count === 0) {
              entries.splice(idx, 1);
            } else {
              entries[idx] = entry;
            }
            return { ...prev, [row.message_id]: entries.length > 0 ? entries : [] };
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId, currentUserId, setReactionsMap]);

  // Initial reactions are hydrated from server-rendered props; no async
  // mount load needed. loadReactions (from useChatReactions) runs after streaming.

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
      (data as Array<Record<string, unknown>>).map((row) =>
        toChatMessage(normalizeMessage(row), memberMapRef.current)
      )
    );
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    await loadReactions(ids);
  }, [chatId, loadReactions]);

  function handleStop() {
    abortRef.current?.abort();
  }

  async function sendMessage(text: string, filesOverride?: FileAttachment[] | null) {
    const filesToSend = filesOverride !== undefined ? (filesOverride ?? []) : attachedFiles;
    if ((!text && !filesToSend.length) || isStreaming) return;

    setInput("");
    setAttachedFiles([]);
    setError(null);
    router.replace(pathname);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;
    const { displayMessage: displayText, pastedAttachments: msgPastedAttachments } = parsePastedAttachments(text);

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: displayText,
        created_at: new Date().toISOString(),
        attachments: filesToSend.length > 0
          ? filesToSend.map((f) => ({ url: f.previewUrl ?? "", type: f.type, filename: f.filename }))
          : undefined,
        sender_id: currentUserId,
        pastedAttachments: msgPastedAttachments.length > 0 ? msgPastedAttachments : undefined,
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

      setWorkingStatus("Thinking…");
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

      // Group projects route through the shared engagement gate: when Bruce isn't
      // addressed the server returns X-Bruce-Responded:false with no stream body.
      // Drop the optimistic placeholder and bail — the finally block reloads
      // messages (picking up any Bruce reaction). Single-member projects always
      // return "true". Mirrors FamilyChatWindow.
      const bruceWillRespond = res.headers.get("X-Bruce-Responded") === "true";
      if (!bruceWillRespond) {
        setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
        return; // finally handles setIsStreaming(false) + loadMessages
      }

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
    <div style={styles.container}>
      <ProjectTopBar
        projectId={projectId}
        projectName={projectName}
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
        reactionsMap={reactionsMap}
        onReact={handleReact}
        inlineCard={browserPanel.open ? browserPanelEl : null}
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
        onBrowserClick={() => (browserPanel.sessionId ? toggleBrowser() : openBrowser())}
        browserActive={browserPanel.open}
        browserOpening={browserOpening}
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
