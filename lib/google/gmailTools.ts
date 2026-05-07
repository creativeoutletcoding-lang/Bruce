// ============================================================
// Bruce — Anthropic tool definitions + executor for Gmail.
// Imported by /api/chat, /api/family/chat, and /api/projects/[id]/chat routes.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import {
  listInboxThreads,
  getThreadDetail,
  searchMessages,
  sendEmail,
  replyToThread,
  archiveMessage,
  deleteMessage,
} from "@/lib/google/gmail";

// ── Tool definitions ──────────────────────────────────────────────────────────

export const GMAIL_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "list_emails",
    description:
      "List recent threads in the user's Gmail inbox. Use this when the user asks " +
      "to check their email, see recent messages, or asks what's in their inbox. " +
      "Returns thread summaries with sender, subject, date, and read status.",
    input_schema: {
      type: "object" as const,
      properties: {
        max_results: {
          type: "number",
          description: "Maximum number of threads to return. Default: 10.",
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
    name: "get_email",
    description:
      "Get the full contents of an email thread including all messages, with decoded body text. " +
      "Use this when the user wants to read a specific email or see a full conversation. " +
      "Requires the thread_id from list_emails or search_emails.",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: {
          type: "string",
          description: "The thread ID from list_emails or search_emails.",
        },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "search_emails",
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
  {
    name: "send_email",
    description:
      "Compose and send a new email on behalf of the user. " +
      "IMPORTANT: You must show the user the full draft (To, Subject, body) and receive explicit confirmation before calling this tool. Never call without confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient email address.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        body: {
          type: "string",
          description: "Plain text email body.",
        },
        from_alias: {
          type: "string",
          description: "Optional sender alias (e.g. 'Jake Johnson <jake@example.com>'). Omit to use the account default.",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "reply_to_email",
    description:
      "Reply to an existing email thread on behalf of the user. " +
      "IMPORTANT: You must show the user the full reply draft and receive explicit confirmation before calling this tool. Never call without confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        thread_id: {
          type: "string",
          description: "The thread ID to reply to. Get this from list_emails or search_emails.",
        },
        body: {
          type: "string",
          description: "Plain text reply body.",
        },
        from_alias: {
          type: "string",
          description: "Optional sender alias. Omit to use the account default.",
        },
      },
      required: ["thread_id", "body"],
    },
  },
  {
    name: "archive_email",
    description:
      "Archive a message — removes it from the inbox but keeps it in All Mail. " +
      "IMPORTANT: Confirm with the user before calling. State the sender and subject of what will be archived.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: {
          type: "string",
          description: "The message ID to archive. Get this from get_email.",
        },
      },
      required: ["message_id"],
    },
  },
  {
    name: "delete_email",
    description:
      "Move a message to Trash. " +
      "IMPORTANT: This is high stakes. Always name the message (sender and subject) and ask the user to explicitly confirm before calling. No exceptions.",
    input_schema: {
      type: "object" as const,
      properties: {
        message_id: {
          type: "string",
          description: "The message ID to move to Trash. Get this from get_email.",
        },
      },
      required: ["message_id"],
    },
  },
];

// ── Tool name set — used for dispatch routing in chat routes ──────────────────

export const GMAIL_TOOL_NAMES = new Set(GMAIL_TOOLS.map((t) => t.name));

// ── System prompt block ───────────────────────────────────────────────────────

export const GMAIL_SYSTEM_BLOCK = `

## Gmail

You have full Gmail access via tools — read, search, send, reply, archive, and delete.

**Three-tier rule for Gmail:**
- Read operations (list_emails, get_email, search_emails): low stakes — act immediately, no confirmation needed. Summarize concisely: sender, subject, and the key point. Never dump raw headers or full body unless the user explicitly asks.
- Send and reply (send_email, reply_to_email): medium stakes — always show the complete draft first (To, Subject, full body) and ask "Want me to send this?" before calling the tool. Never send without explicit confirmation in that same conversation turn.
- Archive (archive_email): medium stakes — state what you are about to archive (sender and subject) and confirm before acting. "Archive the email from X about Y — it will stay in All Mail. Go ahead?"
- Delete (delete_email): high stakes — always name the message being deleted (sender and subject) and ask explicitly before acting. "This will move the email from X with subject Y to Trash. Confirm?" No exceptions.

**General rules:**
- Only use Gmail tools when the user explicitly asks. Never volunteer to check email or mention it at the end of a response.
- Never expose raw thread IDs or message IDs in your response to the user.
- When listing emails, default to 10 most recent unless the user asks for more.`;

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeGmailTool(
  name:   string,
  input:  Record<string, unknown>,
  userId: string
): Promise<string> {
  switch (name) {
    case "list_emails": {
      const maxResults = typeof input.max_results === "number" ? input.max_results : 10;
      const query      = typeof input.query      === "string"  ? input.query      : "";
      const threads = await listInboxThreads(userId, maxResults, query);
      if (threads.length === 0) return "Inbox is empty.";
      return JSON.stringify(threads, null, 2);
    }

    case "get_email": {
      const thread = await getThreadDetail(userId, input.thread_id as string);
      return JSON.stringify(thread, null, 2);
    }

    case "search_emails": {
      const maxResults = typeof input.max_results === "number" ? input.max_results : 10;
      const results = await searchMessages(userId, input.query as string, maxResults);
      if (results.length === 0) return "No messages found matching that query.";
      return JSON.stringify(results, null, 2);
    }

    case "send_email": {
      const result = await sendEmail(
        userId,
        input.to as string,
        input.subject as string,
        input.body as string,
        typeof input.from_alias === "string" ? input.from_alias : undefined
      );
      return JSON.stringify({ sent: true, ...result });
    }

    case "reply_to_email": {
      const result = await replyToThread(
        userId,
        input.thread_id as string,
        input.body as string,
        typeof input.from_alias === "string" ? input.from_alias : undefined
      );
      return JSON.stringify({ sent: true, ...result });
    }

    case "archive_email": {
      await archiveMessage(userId, input.message_id as string);
      return JSON.stringify({ archived: true, messageId: input.message_id });
    }

    case "delete_email": {
      await deleteMessage(userId, input.message_id as string);
      return JSON.stringify({ trashed: true, messageId: input.message_id });
    }

    default:
      return `Unknown Gmail tool: ${name}`;
  }
}
