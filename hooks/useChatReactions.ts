"use client";

import { useCallback, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { aggregateReactions } from "@/lib/chat/reactionUtils";
import type { ReactionEntry } from "@/lib/chat/types";

export type ReactionRow = { message_id: string; user_id: string | null; type: string };

export interface UseChatReactionsOptions {
  /** Present for per-chat API parity with useChatSession. Reaction reads/writes
   *  are keyed by message_id, so this hook never queries by chatId itself. */
  chatId: string;
  currentUserId?: string;
  /** Current user's profile color — used for the optimistic local reaction. */
  userColorHex?: string;
  /** userId → profile color, for aggregating loaded reactions and seeding state. */
  colorMap: Record<string, string | undefined>;
  initialReactions?: ReactionRow[];
}

export interface UseChatReactionsResult {
  reactionsMap: Record<string, ReactionEntry[]>;
  /** Exposed so context-specific realtime subscriptions (project/family) can
   *  apply INSERT/DELETE reaction events into the same state the hook owns. */
  setReactionsMap: React.Dispatch<React.SetStateAction<Record<string, ReactionEntry[]>>>;
  loadReactions: (msgIds: string[]) => Promise<void>;
  handleReact: (messageId: string, type: string) => Promise<void>;
}

// Shared reaction state for every chat context. Owns the reactionsMap, the
// post-stream reload (loadReactions), and the optimistic toggle (handleReact).
// Previously duplicated verbatim across ChatWindow, ProjectChatView, and
// FamilyChatWindow.
export function useChatReactions({
  currentUserId,
  userColorHex,
  colorMap,
  initialReactions,
}: UseChatReactionsOptions): UseChatReactionsResult {
  // Keep the latest colorMap in a ref so loadReactions stays referentially
  // stable (safe in effect deps) while always aggregating with up-to-date
  // member colors.
  const colorMapRef = useRef(colorMap);
  colorMapRef.current = colorMap;

  const [reactionsMap, setReactionsMap] = useState<Record<string, ReactionEntry[]>>(() => {
    if (!initialReactions?.length) return {};
    return aggregateReactions(initialReactions, currentUserId, colorMap);
  });

  const loadReactions = useCallback(async (msgIds: string[]) => {
    const filtered = msgIds.filter((id) => !id.startsWith("tmp-"));
    if (filtered.length === 0) { setReactionsMap({}); return; }
    const supabase = createClient();
    const { data } = await supabase
      .from("reactions")
      .select("message_id, user_id, type")
      .in("message_id", filtered);
    if (!data) return;
    setReactionsMap(aggregateReactions(
      data as ReactionRow[],
      currentUserId,
      colorMapRef.current,
    ));
  }, [currentUserId]);

  const handleReact = useCallback(async (messageId: string, type: string) => {
    // Optimistic update — authoritative; no reload after the write commits.
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
    await fetch(`/api/messages/${messageId}/reaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
  }, [currentUserId, userColorHex]);

  return { reactionsMap, setReactionsMap, loadReactions, handleReact };
}
