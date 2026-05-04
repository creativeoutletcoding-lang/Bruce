"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import MessageInput from "@/components/chat/MessageInput";
import type { FileAttachment } from "@/components/chat/MessageInput";
import PullProgressBar from "@/components/ui/PullProgressBar";
import { lightHaptic } from "@/lib/utils/haptics";
import type { MessageRole } from "@/lib/types";
import type { UserSummary } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FamilyMessage {
  id: string;
  role: MessageRole;
  content: string;
  sender_id: string | null;
  sender_name: string | null;
  sender_avatar: string | null;
  created_at: string;
  isStreaming?: boolean;
  imageUrl?: string;
}

interface ContextMenuState {
  messageId: string;
  content: string;
  x: number;
  y: number;
}

type BruceState = "idle" | "dots" | "working" | "streaming";

// ── Props ─────────────────────────────────────────────────────────────────────

interface FamilyChatWindowProps {
  chatId: string;
  currentUserId: string;
  members: UserSummary[];
  initialMessages: FamilyMessage[];
  topbar: React.ReactNode;
  placeholder?: string;
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
  const [messages, setMessages] = useState<FamilyMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [bruceState, setBruceState] = useState<BruceState>("idle");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentLocation, setCurrentLocation] = useState<string | undefined>(undefined);
  const [attachedFile, setAttachedFile] = useState<FileAttachment | null>(null);

  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    members.forEach((mbr) => { m[mbr.id] = mbr.color_hex; });
    return m;
  }, [members]);

  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const workingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStreamingRef = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTouchStartY = useRef<number>(-1);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Presence heartbeat — tells the server this chat is open so it can suppress
  // push notifications while the user is actively viewing the conversation.
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

  // Mark this chat's notifications as read when the chat is opened, clearing
  // any sidebar unread dot for this specific conversation.
  useEffect(() => {
    fetch("/api/notifications/mark-read", {
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
      () => { /* permission denied — silent */ },
      { timeout: 5000 }
    );
  }, []);

  // Member map for enriching realtime messages
  const memberMap = useRef<Record<string, { name: string; avatar_url: string | null }>>({});
  useEffect(() => {
    memberMap.current = {};
    members.forEach((m) => {
      memberMap.current[m.id] = { name: m.name, avatar_url: m.avatar_url };
    });
  }, [members]);

  // ── Scroll ────────────────────────────────────────────────────────────────

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    endRef.current?.scrollIntoView({ behavior });
  }

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUp.current = !atBottom;
    setShowScrollButton(!atBottom);
  }

  useEffect(() => { scrollToBottom("instant"); }, []);
  useEffect(() => { if (!userScrolledUp.current) scrollToBottom("smooth"); }, [messages]);

  // ── DB reload (replaces temp IDs after sends) ─────────────────────────────

  const loadMessages = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, created_at, sender_id, image_url")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (!data) return;
    setMessages(
      (data as Array<{ id: string; role: string; content: string; created_at: string; sender_id: string | null; image_url?: string | null }>).map(
        (m) => ({
          id: m.id,
          role: m.role as MessageRole,
          content: m.content,
          created_at: m.created_at,
          sender_id: m.sender_id,
          sender_name: m.sender_id ? (memberMap.current[m.sender_id]?.name ?? null) : null,
          sender_avatar: m.sender_id ? (memberMap.current[m.sender_id]?.avatar_url ?? null) : null,
          imageUrl: m.image_url ?? undefined,
        })
      )
    );
  }, [chatId]);

  // ── Realtime for other members' messages ──────────────────────────────────

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
          const msg = payload.new as {
            id: string;
            role: string;
            content: string;
            created_at: string;
            sender_id: string | null;
          };

          // Sender's own messages are shown optimistically; Bruce's via stream
          if (msg.sender_id === currentUserId) return;
          if (msg.sender_id === null && isStreamingRef.current) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            const info = msg.sender_id ? memberMap.current[msg.sender_id] : null;
            return [
              ...prev,
              {
                id: msg.id,
                role: msg.role as MessageRole,
                content: msg.content,
                created_at: msg.created_at,
                sender_id: msg.sender_id,
                sender_name: info?.name ?? null,
                sender_avatar: info?.avatar_url ?? null,
              },
            ];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [chatId, currentUserId]);

  // ── Send ──────────────────────────────────────────────────────────────────

  async function sendMessage(text: string) {
    if ((!text.trim() && !attachedFile) || bruceState !== "idle") return;

    const fileToSend = attachedFile;
    setInput("");
    setAttachedFile(null);
    setError(null);
    setContextMenu(null);

    const userMsgId = `tmp-user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: text,
        sender_id: currentUserId,
        sender_name: memberMap.current[currentUserId]?.name ?? null,
        sender_avatar: memberMap.current[currentUserId]?.avatar_url ?? null,
        created_at: new Date().toISOString(),
        imageUrl: fileToSend?.type === "image" ? fileToSend.previewUrl : undefined,
      },
    ]);

    let bruceWillRespond = false;

    try {
      const res = await fetch("/api/family/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId,
          currentLocation,
          userTimestamp: new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
          image: fileToSend?.type === "image" ? { base64: fileToSend.base64, mediaType: fileToSend.mediaType } : undefined,
          document: fileToSend?.type === "document" ? { base64: fileToSend.base64, mediaType: fileToSend.mediaType, filename: fileToSend.filename } : undefined,
        }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      bruceWillRespond = res.headers.get("X-Bruce-Responded") === "true";

      if (!bruceWillRespond) {
        await loadMessages();
        return;
      }

      const streamMsgId = `tmp-stream-${Date.now()}`;
      isStreamingRef.current = true;

      setBruceState("dots");
      workingTimerRef.current = setTimeout(() => {
        setBruceState((s) => (s === "dots" ? "working" : s));
      }, 2500);

      setMessages((prev) => [
        ...prev,
        {
          id: streamMsgId,
          role: "assistant",
          content: "",
          sender_id: null,
          sender_name: null,
          sender_avatar: null,
          created_at: new Date().toISOString(),
          isStreaming: true,
        },
      ]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setBruceState("streaming");
        setMessages((prev) =>
          prev.map((m) => (m.id === streamMsgId ? { ...m, content: current } : m))
        );
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === streamMsgId ? { ...m, isStreaming: false } : m))
      );
    } catch (err) {
      console.error("[FamilyChatWindow] Send error:", err);
      setError("Something went wrong. Tap to retry.");
      setMessages((prev) => prev.filter((m) => !m.id.startsWith("tmp-")));
    } finally {
      if (workingTimerRef.current) {
        clearTimeout(workingTimerRef.current);
        workingTimerRef.current = null;
      }
      setBruceState("idle");
      isStreamingRef.current = false;
      await loadMessages();
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

  // ── Long press / context menu ─────────────────────────────────────────────

  function handleScrollTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if ((containerRef.current?.scrollTop ?? 1) === 0) {
      scrollTouchStartY.current = e.touches[0].clientY;
    }
  }

  function handleScrollTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (scrollTouchStartY.current < 0) return;
    const dy = Math.max(0, e.touches[0].clientY - scrollTouchStartY.current);
    setPullDistance(dy);
  }

  async function handleScrollTouchEnd() {
    if (pullDistance >= 56) {
      scrollTouchStartY.current = -1;
      setPullDistance(0);
      setIsRefreshing(true);
      lightHaptic();
      await loadMessages();
      setIsRefreshing(false);
    } else {
      setPullDistance(0);
      scrollTouchStartY.current = -1;
    }
  }

  function handleTouchStart(e: React.TouchEvent, msg: FamilyMessage) {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      setContextMenu({
        messageId: msg.id,
        content: msg.content,
        x: Math.min(touch.clientX, window.innerWidth - 180),
        y: Math.min(touch.clientY, window.innerHeight - 100),
      });
    }, 500);
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handleContextMenu(e: React.MouseEvent, msg: FamilyMessage) {
    e.preventDefault();
    setContextMenu({
      messageId: msg.id,
      content: msg.content,
      x: Math.min(e.clientX, window.innerWidth - 180),
      y: Math.min(e.clientY, window.innerHeight - 100),
    });
  }

  function handleAskBruce(content: string) {
    const excerpt = content.replace(/\n/g, " ").substring(0, 60);
    setInput(`@Bruce re: "${excerpt}" — `);
    setContextMenu(null);
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content).catch(() => {});
    setContextMenu(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.container} onClick={() => setContextMenu(null)}>
      {topbar}

      {/* Message list */}
      <div style={styles.listWrapper}>
        <PullProgressBar pullProgress={Math.min(pullDistance / 56, 1)} refreshing={isRefreshing} />
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onTouchStart={handleScrollTouchStart}
          onTouchMove={handleScrollTouchMove}
          onTouchEnd={handleScrollTouchEnd}
          style={styles.listScroll}
        >
          <div style={styles.inner}>
          <div style={styles.spacer} />

          {messages.map((msg, i) => {
            const prevMsg = messages[i - 1];
            const isSameSender = prevMsg?.sender_id === msg.sender_id;
            const isMe = msg.sender_id === currentUserId;
            const isBruce = msg.sender_id === null && msg.role === "assistant";
            const memberColor = msg.sender_id ? (colorMap[msg.sender_id] ?? "#6B7280") : "#6B7280";
            const myColor = colorMap[currentUserId] ?? "#6B7280";

            return (
              <div
                key={msg.id}
                style={{
                  ...styles.messageRow,
                  justifyContent: isMe ? "flex-end" : "flex-start",
                  paddingTop: isSameSender ? "2px" : "10px",
                }}
                onTouchStart={(e) => handleTouchStart(e, msg)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
                onContextMenu={(e) => handleContextMenu(e, msg)}
              >
                <div className="msg-group" style={{ ...styles.messageGroup, alignItems: isMe ? "flex-end" : "flex-start" }}>
                  {!isSameSender && (
                    <div
                      style={{
                        ...styles.senderName,
                        paddingLeft: isMe ? 0 : "2px",
                        paddingRight: isMe ? "2px" : 0,
                      }}
                    >
                      {isBruce ? "Bruce" : (msg.sender_name ?? "Someone")}
                    </div>
                  )}

                  <div
                    style={{
                      ...styles.bubble,
                      ...(isMe
                        ? { ...styles.meBubble, backgroundColor: myColor }
                        : isBruce
                        ? styles.bruceBubble
                        : { ...styles.memberBubble, borderColor: `${memberColor}50` }),
                    }}
                  >
                    {msg.isStreaming && !msg.content ? (
                      <>
                        <div style={styles.dotsRow}>
                          <span style={styles.dot1} />
                          <span style={styles.dot2} />
                          <span style={styles.dot3} />
                        </div>
                        {bruceState === "working" && (
                          <div style={styles.indicatorStatus}>Working on it…</div>
                        )}
                      </>
                    ) : (
                      <>
                        {msg.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={msg.imageUrl} alt="" style={{ maxWidth: "240px", width: "100%", borderRadius: "var(--radius-md)", display: "block", marginBottom: msg.content ? "8px" : 0 }} />
                        ) : null}
                        {msg.content}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div style={styles.bottomPad} />
          <div ref={endRef} />
          </div>
        </div>

        {showScrollButton && (
          <button
            onClick={() => { userScrolledUp.current = false; scrollToBottom("smooth"); }}
            style={styles.scrollButton}
            aria-label="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10M4 9l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

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
        disabled={bruceState !== "idle"}
        placeholder={placeholder}
        attachedFile={attachedFile}
        onFileAttach={(f) => setAttachedFile(f)}
        onFileClear={() => setAttachedFile(null)}
      />

      {contextMenu && (
        <>
          <div style={styles.menuBackdrop} onClick={() => setContextMenu(null)} />
          <div
            style={{ ...styles.contextMenu, left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button style={styles.menuItem} onClick={() => handleAskBruce(contextMenu.content)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 1C3.686 1 1 3.134 1 5.75c0 1.4.7 2.65 1.82 3.52-.12.86-.55 1.73-1.32 2.23a4.5 4.5 0 0 0 3.13-1.08C5.1 10.61 6.03 10.75 7 10.75 10.314 10.75 13 8.616 13 6S10.314 1 7 1Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              Ask Bruce
            </button>
            <button style={styles.menuItem} onClick={() => handleCopy(contextMenu.content)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M2 10V3a1 1 0 0 1 1-1h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Copy
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" },
  listWrapper: { flex: 1, position: "relative", overflow: "hidden" },
  listScroll: { height: "100%", overflowY: "auto", display: "flex", flexDirection: "column" },
  inner: { width: "100%", maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", flex: 1 },
  spacer: { flex: 1 },
  bottomPad: { height: "8px" },
  messageRow: { display: "flex", padding: "0 14px" },
  messageGroup: { display: "flex", flexDirection: "column", gap: "3px" },
  senderName: { fontSize: "0.6875rem", fontWeight: "400", letterSpacing: "0.01em", marginBottom: "1px", color: "var(--text-tertiary)" },
  bubble: { padding: "10px 14px", borderRadius: "var(--radius-lg)", fontSize: "0.9375rem", lineHeight: "1.55", wordBreak: "break-word", whiteSpace: "pre-wrap", userSelect: "text" },
  meBubble: { color: "#ffffff", borderBottomRightRadius: "4px" },
  bruceBubble: { backgroundColor: "transparent", color: "var(--text-primary)", border: "1px solid #2a2a2a", borderBottomLeftRadius: "4px" },
  memberBubble: { backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", border: "2px solid", borderBottomLeftRadius: "4px" },
  dotsRow: { display: "flex", alignItems: "center", gap: "4px" },
  dot1: { display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--text-tertiary)", animation: "dotFade 1.2s ease-in-out infinite", animationDelay: "0ms" },
  dot2: { display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--text-tertiary)", animation: "dotFade 1.2s ease-in-out infinite", animationDelay: "150ms" },
  dot3: { display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "var(--text-tertiary)", animation: "dotFade 1.2s ease-in-out infinite", animationDelay: "300ms" },
  indicatorStatus: { fontSize: "0.6875rem", color: "var(--text-tertiary)", lineHeight: 1.3 },
  scrollButton: { position: "absolute", bottom: "16px", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-full)", color: "var(--text-secondary)", cursor: "pointer", boxShadow: "var(--shadow-md)" },
  errorRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", padding: "8px 16px", flexShrink: 0 },
  errorText: { fontSize: "0.8125rem", color: "var(--text-secondary)" },
  retryButton: { fontSize: "0.8125rem", fontWeight: "500", color: "var(--accent)", cursor: "pointer" },
  menuBackdrop: { position: "fixed", inset: 0, zIndex: 400 },
  contextMenu: { position: "fixed", zIndex: 401, backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-lg)", overflow: "hidden", minWidth: "160px" },
  menuItem: { width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "11px 16px", fontSize: "0.875rem", color: "var(--text-primary)", cursor: "pointer", textAlign: "left", transition: "background-color var(--transition)" },
};
