// Shared route-side plumbing for the engagement decision (lib/chat/engagement.ts).
//
// The family and group-project routes both need to turn raw message rows into the
// speaker-labeled history `decideEngagement` consumes, and to resolve a
// `nameForSender` map so the classifier sees real "Laurianne:"/"Bruce:" labels
// (never a flattened "Member"). These two helpers are the single implementation
// both routes call — keep them here so the history-labeler does not drift into
// two divergent copies.

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatAssistantReplay } from "./toolTrace";
import type { EngagementHistoryEntry } from "./engagement";

/**
 * Whether a room should route through the engagement gate. Group rooms (more than
 * one member) gate; a single-member project keeps the always-respond contract.
 * The project route calls this; family rooms are always multi-member by nature.
 */
export function shouldEngagementGate(memberCount: number): boolean {
  return memberCount > 1;
}

export interface RawEngagementRow {
  role: string;
  content: string | null;
  sender_id: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Build the speaker-labeled engagement history from raw message rows in
 * chronological order. Assistant turns replay their tool trace (so Bruce's
 * pending questions/proposals survive for the open-question window); attachment-
 * only member messages get a textual placeholder; empty messages are dropped.
 */
export function buildEngagementHistory(rows: RawEngagementRow[]): EngagementHistoryEntry[] {
  return rows
    .map((m) => {
      const text = m.content ?? "";
      if (m.role === "assistant") {
        return { role: m.role, content: formatAssistantReplay(text, m.metadata), sender_id: m.sender_id };
      }
      const metaAttachments = m.metadata?.attachments as Array<{ type: string; filename?: string }> | undefined;
      if (metaAttachments && metaAttachments.length > 0 && !text.trim()) {
        const desc = metaAttachments
          .map((a) => (a.type === "document" ? `[document: ${a.filename ?? "file"}]` : "[image]"))
          .join(", ");
        return { role: m.role, content: desc, sender_id: m.sender_id };
      }
      return { role: m.role, content: text, sender_id: m.sender_id };
    })
    .filter((m) => m.content.trim().length > 0);
}

/**
 * Resolve a `nameForSender` function for every speaker in the history (plus the
 * current sender, supplied directly to avoid a redundant lookup). null → "Bruce";
 * an unknown id → "Member". Uses the service-role client because `users` RLS is
 * own-row-only.
 */
export async function buildNameForSender(
  adminSupabase: SupabaseClient,
  history: EngagementHistoryEntry[],
  currentUserId: string,
  currentUserName: string
): Promise<(senderId: string | null) => string> {
  const speakerIds = Array.from(
    new Set(history.map((m) => m.sender_id).filter((id): id is string => !!id))
  ).filter((id) => id !== currentUserId);

  const nameMap: Record<string, string> = { [currentUserId]: currentUserName };
  if (speakerIds.length > 0) {
    const { data: speakerRows } = await adminSupabase
      .from("users")
      .select("id, name")
      .in("id", speakerIds);
    for (const r of (speakerRows ?? []) as Array<{ id: string; name: string }>) {
      nameMap[r.id] = r.name;
    }
  }
  return (senderId: string | null): string =>
    senderId === null ? "Bruce" : nameMap[senderId] ?? "Member";
}
