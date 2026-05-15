"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import MessageList from "@/components/chat/MessageList";
import MessageInput from "@/components/chat/MessageInput";
import type { ChatMessage, MessageAttachment, NormalizedMessage } from "@/lib/chat/types";
import type { FileAttachment } from "@/components/chat/MessageInput";
import type { UserSummary } from "@/lib/types";
import {
  consumeStream,
  resolveAbandonedTaskSteps,
} from "@/lib/chat/clientStream";
import { useChatMemory } from "@/lib/chat/useChatMemory";
import { getDisplayName } from "@/lib/chat/senderProfile";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import { extractLatestTaskProgress, stripTaskProgressTags } from "@/lib/chat/taskProgress";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FamilyChatWindowProps {
  chatId: string;
  currentUserId: string;
  members: UserSummary[];
  initialMessages: NormalizedMessage[];
  topbar: React.ReactNode;
  placeholder?: string;
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
}: FamilyChatWindowProps) {
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
  const [currentLocation, setCurrentLocation] = useState<string | undefined>(undefined);
  const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);

  const isStreamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const userColorHex = memberMapRef.current[currentUserId]?.color_hex;

  useChatMemory({ chatId, messageCount: messages.length });

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

  // Mark this chat as read on open (clears sidebar unread dot and notifications).
  useEffect(() => {
    fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
      keepalive: true,
    }).catch(() => {});
    fetch("/api/chats/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
      keepalive: true,
    }).catch(() => {});
  }, [chatId]);

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
        } catch { /* silent */ }
      },
      () => {},
      { timeout: 5000 }
    );
  }, []);

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
  }, [chatId]);

  // Realtime — pick up other members' messages
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
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [chatId, currentUserId]);

  function handleStop() {
    abortRef.current?.abort();
  }

  async function sendMessage(text: string) {
    if ((!text.trim() && !attachedFiles.length) || isStreaming) return;

    const filesToSend = attachedFiles;
    setInput("");
    setAttachedFiles([]);
    setError(null);

    const userMsgId = `tmp-user-${Date.now()}`;
    const streamMsgId = `tmp-stream-${Date.now()}`;
    const senderInfo = memberMapRef.current[currentUserId];

    // Show user message + typing dots immediately, before the fetch resolves.
    // If Bruce won't respond (X-Bruce-Responded: false), the dots are removed below.
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user" as const,
        content: text,
        sender_id: currentUserId,
        senderName: senderInfo ? getDisplayName(senderInfo.name) : undefined,
        senderColorHex: senderInfo?.color_hex,
        created_at: new Date().toISOString(),
        attachments: filesToSend.length > 0
          ? filesToSend.map((f) => ({ url: f.previewUrl ?? "", type: f.type, filename: f.filename }))
          : undefined,
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
        onTick: ({ display, task, workingStatus: ws }) => {
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

      const finalTask = extractLatestTaskProgress(accumulated);
      const finalDisplay = stripTaskProgressTags(accumulated).trim();

      if (finalTask) {
        const resolved = resolveAbandonedTaskSteps(finalTask, aborted ? "interrupted" : "incomplete");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? { ...m, content: finalDisplay, isStreaming: false, taskData: resolved, ...(aborted ? { interrupted: true } : {}) }
              : m
          )
        );
      } else if (finalDisplay) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId
              ? { ...m, content: finalDisplay, isStreaming: false, ...(aborted ? { interrupted: true } : {}) }
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
    if (error) console.error("[FamilyChatWindow] deleteMessage failed:", error);
  }

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
