import type { ReactionEntry } from "@/lib/chat/types";

export const REACTION_EMOJI: Record<string, string> = {
  thumbs_up: "👍",
  heart: "❤️",
};

export function aggregateReactions(
  rows: Array<{ message_id: string; user_id: string | null; type: string }>,
  currentUserId: string | undefined,
  colorByUserId: Record<string, string | undefined>,
): Record<string, ReactionEntry[]> {
  const result: Record<string, ReactionEntry[]> = {};

  for (const row of rows) {
    if (!result[row.message_id]) result[row.message_id] = [];
    let entry = result[row.message_id].find((e) => e.type === row.type);
    if (!entry) {
      entry = { type: row.type, count: 0, reactors: [], hasCurrentUser: false };
      result[row.message_id].push(entry);
    }
    entry.count++;
    entry.reactors.push({
      userId: row.user_id,
      colorHex: row.user_id ? colorByUserId[row.user_id] : "#0F6E56",
    });
    if (row.user_id && row.user_id === currentUserId) entry.hasCurrentUser = true;
  }

  return result;
}
