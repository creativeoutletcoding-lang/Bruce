// Shared chat-layer types — consume DB rows and feed UI state.
//
// `NormalizedMessage` is the canonical DB-shape produced by normalizeMessage().
// `ChatMessage` and `MessageAttachment` are the UI shapes consumed by
// MessageList / MessageBubble across all three chat contexts.

import type { MessageRole } from "@/lib/types";
import type { TaskProgressData } from "@/lib/chat/taskProgress";
import type { PastedAttachmentData } from "@/lib/chat/pastedText";

export type { PastedAttachmentData };

export interface NormalizedMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  sender_id: string | null;
  image_url: string | null;
  attachment_type: string | null;
  attachment_filename: string | null;
  metadata: Record<string, unknown> | null;
}

export interface MessageAttachment {
  url: string;
  type: string;
  filename?: string;
}

export interface ReactionReactor {
  userId: string | null; // null = Bruce
  colorHex?: string;
}

export interface ReactionEntry {
  type: string;
  count: number;
  reactors: ReactionReactor[];
  hasCurrentUser: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  created_at?: string;
  isStreaming?: boolean;
  /** Set when the user pressed Stop while this message was streaming. */
  interrupted?: boolean;
  metadata?: Record<string, unknown>;
  attachments?: MessageAttachment[];
  // Legacy single-attachment fields (kept for backward compat with old DB rows)
  imageUrl?: string;
  attachmentType?: string;
  attachmentFilename?: string;
  sender_id?: string | null;
  senderName?: string;
  senderColorHex?: string;
  taskData?: TaskProgressData | null;
  pastedAttachments?: PastedAttachmentData[];
}
