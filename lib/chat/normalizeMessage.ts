// Single normalization point for any raw Supabase `messages` row or realtime
// payload. Returns the canonical NormalizedMessage shape with all DB fields
// safely typed and nullable handling settled. Never construct a Message object
// from raw DB data inline — always go through this function.

import type { MessageRole } from "@/lib/types";
import type { NormalizedMessage } from "@/lib/chat/types";

export function normalizeMessage(raw: Record<string, unknown>): NormalizedMessage {
  return {
    id: raw.id as string,
    role: raw.role as MessageRole,
    content: (raw.content as string | null) ?? "",
    created_at: raw.created_at as string,
    sender_id: (raw.sender_id as string | null) ?? null,
    image_url: (raw.image_url as string | null | undefined) ?? null,
    attachment_type: (raw.attachment_type as string | null | undefined) ?? null,
    attachment_filename: (raw.attachment_filename as string | null | undefined) ?? null,
    metadata: (raw.metadata as Record<string, unknown> | null | undefined) ?? null,
  };
}
