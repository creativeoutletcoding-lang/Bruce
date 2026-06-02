"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage } from "@/lib/chat/types";

export interface UseChatSessionOptions {
  chatId: string;
  /** Present for API parity; the extracted helpers don't read it currently. */
  currentUserId?: string;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export interface UseChatSessionResult {
  /** Reverse-geocoded "City, State" from the browser, or undefined. */
  currentLocation: string | undefined;
  deleteMessage: (msgId: string) => Promise<void>;
  handleRetry: () => void;
}

// Shared per-chat session plumbing for every chat context: device-location
// lookup, mark-read on open, message deletion, and the retry-last-message
// action. Previously duplicated verbatim across ChatWindow, ProjectChatView,
// and FamilyChatWindow.
export function useChatSession({
  chatId,
  messages,
  setMessages,
  setInput,
  setError,
}: UseChatSessionOptions): UseChatSessionResult {
  const [currentLocation, setCurrentLocation] = useState<string | undefined>(undefined);

  // Reverse-geocode the device location once on mount for location-aware replies.
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

  // Mark this chat as read on open (clears the sidebar unread dot).
  useEffect(() => {
    fetch("/api/chats/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId }),
      keepalive: true,
    }).catch(() => {});
  }, [chatId]);

  const deleteMessage = useCallback(async (msgId: string) => {
    if (msgId.startsWith("tmp-")) return;
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    const supabase = createClient();
    const { error } = await supabase.from("messages").delete().eq("id", msgId);
    if (error) console.error("[useChatSession] deleteMessage failed:", error);
  }, [setMessages]);

  const handleRetry = useCallback(() => {
    setError(null);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      setInput(lastUser.content);
      setMessages((prev) => prev.filter((m) => m.id !== lastUser.id));
    }
  }, [messages, setError, setInput, setMessages]);

  return { currentLocation, deleteMessage, handleRetry };
}
