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
import type { FileAttachment } from "./MessageInput";
import type { ChatMessage, NormalizedMessage, ReactionEntry } from "@/lib/chat/types";
import type { MessageRole } from "@/lib/types";
import { aggregateReactions } from "@/lib/chat/reactionUtils";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import { modelLabel } from "@/lib/models";
import {
  consumeStream,
  extractImageRequest,
  resolveAbandonedTaskSteps,
} from "@/lib/chat/clientStream";
import { useChatMemory } from "@/lib/chat/useChatMemory";

type ReactionRow = { message_id: string; user_id: string | null; type: string };

interface ChatWindowProps {
  chatId: string;
  initialMessages: NormalizedMessage[];
  initialTitle: string;
  userColorHex?: string;
  initialModel?: string;
  currentUserId?: string;
  initialReactions?: ReactionRow[];
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
}: ChatWindowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { incognito } = useChatContext();
  const [isClient, setIsClient] = useState(() => typeof window !== "undefined");
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((n) => toChatMessage(n))
  );
  const [title, setTitle] = useState(initialTitle);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<string | undefined>(undefined);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
  const [model, setModel] = useState(initialModel ?? "claude-sonnet-4-6");
  const [reactionsMap, setReactionsMap] = useState<Record<string, ReactionEntry[]>>(() => {
    if (!initialReactions?.length) return {};
    const colorMap: Record<string, string | undefined> = currentUserId ? { [currentUserId]: userColorHex } : {};
    return aggregateReactions(initialReactions, currentUserId, colorMap);
  });
  const abortRef = useRef<AbortController | null>(null);

  useChatMemory({ chatId, messageCount: messages.length, disabled: incognito });

  const loadReactions = useCallback(async (msgIds: string[]) => {
    const filtered = msgIds.filter((id) => !id.startsWith("tmp-"));
    if (filtered.length === 0) { setReactionsMap({}); return; }
    const supabase = createClient();
    const { data } = await supabase
      .from("reactions")
      .select("message_id, user_id, type")
      .in("message_id", filtered);
    if (!data) return;
    const colorMap: Record<string, string | undefined> = currentUserId ? { [currentUserId]: userColorHex } : {};
    setReactionsMap(aggregateReactions(
      data as Array<{ message_id: string; user_id: string | null; type: string }>,
      currentUserId,
      colorMap,
    ));
  }, [currentUserId, userColorHex]);

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

  const handleReact = useCallback(async (messageId: string, type: string) => {
    // Optimistic update
    setReactionsMap((prev) => {
      const entries = prev[messageId] ? [...prev[messageId]] : [];
      const idx = entries.findIndex((e) => e.type === type);
      if (idx !== -1) {
        const entry = { ...entries[idx] };
        if (entry.hasCurrentUser) {
          entry.count = Math.max(0, entry.count - 1);
          entry.hasCurrentUser = false;
          entry.reactors = entry.reactors.filter((r) => r.userId !== currentUserId);
          entries[idx] = entry;
          if (entry.count === 0) entries.splice(idx, 1);
        } else {
          entry.count += 1;
          entry.hasCurrentUser = true;
          entry.reactors = [...entry.reactors, { userId: currentUserId ?? null, colorHex: userColorHex }];
          entries[idx] = entry;
        }
      } else {
        entries.push({
          type,
          count: 1,
          hasCurrentUser: true,
          reactors: [{ userId: currentUserId ?? null, colorHex: userColorHex }],
        });
      }
      return { ...prev, [messageId]: entries };
    });
    // Await so the write commits before the user can navigate away.
    // No reload after — optimistic update is authoritative.
    await fetch(`/api/messages/${messageId}/reaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
  }, [currentUserId, userColorHex]);

  useEffect(() => { setIsClient(true); }, []);

  // Initial reactions hydrated from server props; loadReactions used after streaming.

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
      () => {},
      { timeout: 5000 }
    );
  }, []);

  // Mark chat as read on open (clears sidebar unread dot).
  useEffect(() => {
    fetch("/api/chats/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
      keepalive: true,
    }).catch(() => {});
  }, [chatId]);

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
        onTick: ({ display, task, workingStatus: ws }) => {
          if (!hasFirstContent && (display.trim() || task)) {
            hasFirstContent = true;
            setWorkingStatus(null);
          }
          if (ws !== null) setWorkingStatus(ws);
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

      const { display: finalText, task: finalTask } = (() => {
        const idx = accumulated.indexOf("\x1f");
        const raw = idx !== -1 ? accumulated.slice(0, idx) : accumulated;
        return {
          display: raw
            .replace(/\x1eSTATUS:[^\x1e]*\x1e/g, "")
            .replace(/\x1eTASK_PROGRESS:[^\x1e]*\x1e/g, "")
            .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
            .replace(/<task_progress>[\s\S]*?<\/task_progress>/g, "")
            .replace(/<task_progress>[\s\S]*/g, "")
            .trim(),
          task: (() => {
            const re = /<task_progress>([\s\S]*?)<\/task_progress>/g;
            let latest = null;
            let m;
            while ((m = re.exec(raw)) !== null) {
              try { latest = JSON.parse(m[1]); } catch { /* skip */ }
            }
            return latest;
          })(),
        };
      })();

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
      }
    }
  }

  function handleRetry() {
    setError(null);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      setMessages((prev) => prev.filter((m) => m.id !== lastUser.id));
    }
  }

  async function deleteMessage(msgId: string) {
    if (msgId.startsWith("tmp-")) return;
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    const supabase = createClient();
    const { error } = await supabase.from("messages").delete().eq("id", msgId);
    if (error) console.error("[ChatWindow] deleteMessage failed:", error);
  }

  return (
    <div
      style={{
        ...styles.container,
        ...(incognito ? styles.incognitoFilter : {}),
      }}
    >
      <TopBar title={title || "New Chat"} hasMessages={messages.length > 0} model={model} onModelChange={handleModelChange} statusText={workingStatus} />

      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}

      <MessageList messages={messages} onRefresh={loadMessages} userColorHex={userColorHex} streamingStatus={workingStatus} currentUserId={currentUserId} onDeleteMessage={deleteMessage} reactionsMap={reactionsMap} onReact={handleReact} />

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
