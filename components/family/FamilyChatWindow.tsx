"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { parsePastedAttachments } from "@/lib/chat/pastedText";
import type { PastedAttachmentData } from "@/lib/chat/types";
import { createClient } from "@/lib/supabase/client";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import type { ChatMessage, MessageAttachment, NormalizedMessage } from "@/lib/chat/types";
import type { FileAttachment } from "@/components/chat/MessageInput";
import type { UserSummary } from "@/lib/types";
import {
  consumeStream,
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
import { workingLogToDisplay } from "@/lib/chat/workingLog";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReactionRow = { message_id: string; user_id: string | null; type: string };

interface FamilyChatWindowProps {
  chatId: string;
  currentUserId: string;
  members: UserSummary[];
  initialMessages: NormalizedMessage[];
  topbar: React.ReactNode;
  placeholder?: string;
  initialReactions?: ReactionRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toChatMessage(
  n: NormalizedMessage,
  memberMap: Record<string, { name: string; color_hex: string }>
): ChatMessage {
  const senderInfo = n.sender_id ? memberMap[n.sender_id] : null;
  const metaAttachments = n.metadata?.attachments as MessageAttachment[] | undefined;
  const attachments = metaAttachments?.length
    ? metaAttachments
    : (n.image_url ? [{ url: n.image_url, type: n.attachment_type ?? "image", filename: n.attachment_filename ?? undefined }] : undefined);
  const workingLog = workingLogToDisplay(n.working_log);
  return {
    id: n.id,
    role: n.role,
    content: n.content,
    created_at: n.created_at,
    metadata: n.metadata ?? undefined,
    attachments,
    sender_id: n.sender_id ?? undefined,
    senderName: senderInfo ? getDisplayName(senderInfo.name) : undefined,
    senderColorHex: senderInfo?.color_hex,
    pastedAttachments: (n.metadata?.pastedAttachments as PastedAttachmentData[] | undefined),
    workingLog: workingLog.length > 0 ? workingLog : undefined,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FamilyChatWindow({
  chatId,
  currentUserId,
  members,
  initialMessages,
  topbar,
  placeholder = "Message the family…",
  initialReactions,
}: FamilyChatWindowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const memberMapRef = useRef<Record<string, { name: string; color_hex: string }>>(
    Object.fromEntries(members.map((m) => [m.id, { name: m.name, color_hex: m.color_hex }]))
  );

  const [messages, setMessages] = useState<ChatMessage[]>(
    initialMessages.map((m) => toChatMessage(m, memberMapRef.current))
  );
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [workingStatus, setWorkingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);

  const isStreamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const userColorHex = memberMapRef.current[currentUserId]?.color_hex;

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

  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => {
    memberMapRef.current = Object.fromEntries(members.map((m) => [m.id, { name: m.name, color_hex: m.color_hex }]));
  }, [members]);

  // Presence heartbeat
  useEffect(() => {
    const beat = () => {
      fetch("/api/notifications/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
        keepalive: true,
      }).catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 30_000);
    return () => clearInterval(interval);
  }, [chatId]);

  // Mark family notifications read on open. The shared sidebar-dot mark-read
  // (/api/chats/mark-read) is handled by useChatSession.
  useEffect(() => {
    fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
      keepalive: true,
    }).catch(() => {});
  }, [chatId]);

  const loadMessages = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, created_at, sender_id, image_url, attachment_type, attachment_filename, metadata")
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

  // Initial reactions hydrated from server props; loadReactions used after streaming.

  // Realtime — messages + reactions
  useEffect(() => {
    const supabase = createClient();
    const topic = `family-${chatId}`;
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
            return [...prev, toChatMessage(n, memberMapRef.current)];
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

  function handleStop() {
    abortRef.current?.abort();
  }

  async function sendMessage(text: string) {
    if ((!text.trim() && !attachedFiles.length) || isStreaming) return;

    const filesToSend = attachedFiles;
    setInput("");
    setAttachedFiles([]);
    setError(null);
    router.replace(pathname);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;
    const senderInfo = memberMapRef.current[currentUserId];
    const { displayMessage: displayText, pastedAttachments: msgPastedAttachments } = parsePastedAttachments(text);

    // Show user message + typing dots immediately, before the fetch resolves.
    // If Bruce won't respond (X-Bruce-Responded: false), the dots are removed below.
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user" as const,
        content: displayText,
        sender_id: currentUserId,
        senderName: senderInfo ? getDisplayName(senderInfo.name) : undefined,
        senderColorHex: senderInfo?.color_hex,
        created_at: new Date().toISOString(),
        attachments: filesToSend.length > 0
          ? filesToSend.map((f) => ({ url: f.previewUrl ?? "", type: f.type, filename: f.filename }))
          : undefined,
        pastedAttachments: msgPastedAttachments.length > 0 ? msgPastedAttachments : undefined,
      },
      {
        id: streamMsgId,
        role: "assistant" as const,
        content: "",
        created_at: new Date().toISOString(),
        isStreaming: true,
      },
    ]);
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      setWorkingStatus("Thinking…");
      const res = await fetch("/api/family/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId,
          currentLocation,
          userTimestamp: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
          attachments: filesToSend.length > 0
            ? filesToSend.map((f) => ({ base64: f.base64, mediaType: f.mediaType, filename: f.filename, type: f.type }))
            : undefined,
        }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const bruceWillRespond = res.headers.get("X-Bruce-Responded") === "true";
      if (!bruceWillRespond) {
        // Remove typing dots — Bruce won't respond to this message.
        setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
        return; // finally handles setIsStreaming(false) + loadMessages
      }

      const { accumulated, aborted } = await consumeStream({
        response: res,
        signal: abort.signal,
        onTick: ({ display, task, workingStatus: ws, browserEvent, workingLog }) => {
          if (ws !== null) setWorkingStatus(ws);
          if (browserEvent) applyBrowserEvent(browserEvent);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === streamMsgId
                ? { ...m, content: display, workingLog: workingLog.length > 0 ? workingLog : undefined, ...(task !== null ? { taskData: task } : {}) }
                : m
            )
          );
        },
      });

      setWorkingStatus(null);

      const { display: finalDisplay, task: finalTask, workingLog: finalLog } = finalizeStream(accumulated);
      const finalWorkingLog = finalLog.length > 0 ? finalLog : undefined;

      if (finalTask) {
        const resolved = resolveAbandonedTaskSteps(finalTask, aborted ? "interrupted" : "incomplete");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? { ...m, content: finalDisplay, isStreaming: false, taskData: resolved, workingLog: finalWorkingLog, ...(aborted ? { interrupted: true } : {}) }
              : m
          )
        );
      } else if (finalDisplay || finalWorkingLog) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? { ...m, content: finalDisplay, isStreaming: false, workingLog: finalWorkingLog, ...(aborted ? { interrupted: true } : {}) }
              : m
          )
        );
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== streamMsgId));
      }
    } catch (err) {
      if (abort.signal.aborted) {
        // Update streaming message (if any) to interrupted
        setMessages((prev) =>
          prev.map((m) =>
            m.isStreaming ? { ...m, isStreaming: false, interrupted: true } : m
          )
        );
      } else {
        console.error("[FamilyChatWindow] Send error:", err);
        setError("Something went wrong. Tap to retry.");
        setMessages((prev) => prev.filter((m) => !m.id.startsWith("tmp-")));
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
      {topbar}

      <MessageList
        messages={messages}
        onRefresh={loadMessages}
        userColorHex={userColorHex}
        streamingStatus={workingStatus}
        currentUserId={currentUserId}
        onDeleteMessage={deleteMessage}
        groupContext
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
        placeholder={placeholder}
        attachedFiles={attachedFiles}
        onFilesAttach={(files) => setAttachedFiles((prev) => [...prev, ...files])}
        onFileRemove={(i) => setAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))}
        onBrowserClick={() => (browserPanel.sessionId ? toggleBrowser() : openBrowser())}
        browserActive={browserPanel.open}
        browserOpening={browserOpening}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" },
  errorRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", padding: "8px 16px", flexShrink: 0 },
  errorText: { fontSize: "0.8125rem", color: "var(--text-secondary)" },
  retryButton: { fontSize: "0.8125rem", fontWeight: "500", color: "var(--accent)", cursor: "pointer" },
};
