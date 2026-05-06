// ============================================================
// Bruce — Anthropic tool definitions + executor for Gmail.
// Imported by /api/chat, /api/family/chat, and /api/projects/[id]/chat routes.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import {
  listInboxThreads,
  getThreadDetail,
  searchMessages,
} from "@/lib/google/gmail";

// ── Tool definitions ──────────────────────────────────────────────────────────

export const GMAIL_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "list_inbox",
    description:
      "List recent threads in the user's Gmail inbox. Use this when the user asks " +
      "to check their email, see recent messages, or asks what's in their inbox. " +
      "Returns thread summaries with sender, subject, date, and read status.",
    input_schema: {
      type: "object" as const,
      properties: {
        max_results: {
          type: "number",
          description: "Maximum number of threads to return. Default: 20.",
        },
        query: {
          type: "string",
          description:
            "Optional Gmail search query to filter results (e.g. 'is:unread', 'from:boss@example.com'). " +
            "Omit to list all inbox threads.",
        },
      },
    },
  },
  {
    name: "get_thread",
    description:
      "Get the full contents of an email thread including all messages, with decoded body text. " +
      "Use this when the user wants to read a specific email or see a full conversation. " +
      "Requires the thread_id from list_inbox or search_messages.",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: {
          type: "string",
          description: "The thread ID from list_inbox or search_messages.",
        },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "search_messages",
    description:
      "Search Gmail messages using a query string. Supports all Gmail search operators " +
      "(from:, to:, subject:, is:unread, has:attachment, after:, before:, etc.). " +
      "Use this when the user wants to find specific emails.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Gmail search query. Examples: 'from:amazon.com', 'subject:invoice', 'is:unread'.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return. Default: 10.",
        },
      },
      required: ["query"],
    },
  },
];

// ── Tool name set — used for dispatch routing in chat routes ──────────────────

export const GMAIL_TOOL_NAMES = new Set(GMAIL_TOOLS.map((t) => t.name));

// ── System prompt block ───────────────────────────────────────────────────────

export const GMAIL_SYSTEM_BLOCK = `

## Gmail

You have read-only access to the user's Gmail inbox via tools.

- Only use Gmail tools when the user explicitly asks about email. Never volunteer to check email or mention it at the end of a response.
- Read operations (list_inbox, get_thread, search_messages): act immediately, no confirmation needed.
- You cannot send, reply, archive, or delete email — read access only.
- When reading email, summarize concisely — sender, subject, and the key point. Don't dump raw headers or full body unless the user asks.`;

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeGmailTool(
  name:   string,
  input:  Record<string, unknown>,
  userId: string
): Promise<string> {
  switch (name) {
    case "list_inbox": {
      const maxResults = typeof input.max_results === "number" ? input.max_results : 20;
      const query      = typeof input.query      === "string"  ? input.query      : "";
      const threads = await listInboxThreads(userId, maxResults, query);
      if (threads.length === 0) return "Inbox is empty.";
      return JSON.stringify(threads, null, 2);
    }

    case "get_thread": {
      const thread = await getThreadDetail(userId, input.thread_id as string);
      return JSON.stringify(thread, null, 2);
    }

    case "search_messages": {
      const maxResults = typeof input.max_results === "number" ? input.max_results : 10;
      const results = await searchMessages(userId, input.query as string, maxResults);
      if (results.length === 0) return "No messages found matching that query.";
      return JSON.stringify(results, null, 2);
    }

    default:
      return `Unknown Gmail tool: ${name}`;
  }
}
