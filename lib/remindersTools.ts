import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const REMINDERS_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "manage_reminders",
    description: `Manage personal reminders for the current user. Use this when they say "remind me to X at Y", ask to see their reminders, mark one done, or want to snooze one.

Actions:
- create: Add a new reminder. Low stakes — create without asking for confirmation. Acknowledge briefly: "Done — I'll remind you at 2 PM."
- list: Retrieve pending reminders. Present conversationally, never as a raw data dump.
- complete: Mark a reminder done by its ID. Act immediately and confirm in one sentence.
- snooze: Delay a reminder to a new time by its ID. Act immediately and confirm briefly.`,
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "complete", "snooze"],
          description: "Operation to perform",
        },
        content: {
          type: "string",
          description: "What to remind the user about. Required for action: create.",
        },
        remind_at: {
          type: "string",
          description:
            "ISO 8601 timestamp for when to send the reminder. Required for action: create.",
        },
        id: {
          type: "string",
          description:
            "Reminder UUID. Required for action: complete or snooze.",
        },
        snooze_until: {
          type: "string",
          description:
            "ISO 8601 timestamp for the new reminder time. Required for action: snooze.",
        },
      },
      required: ["action"],
    },
  },
];

export const REMINDERS_SYSTEM_BLOCK = `

## Reminders

Use manage_reminders to create, list, complete, and snooze the user's personal reminders.

- "Remind me to X at Y" → call manage_reminders (action: create) immediately, no confirmation needed. Acknowledge briefly after: "Done — I'll remind you at 2 PM."
- Listing: present conversationally. "You have a call with the vet at 2 PM and groceries tomorrow morning." Never show raw IDs or ISO timestamps.
- Completing and snoozing are low stakes — act and confirm in one sentence.
- If upcoming reminders are in your context and the conversation topic touches one, mention it naturally — don't wait to be asked.`;

interface ReminderRow {
  id: string;
  content: string;
  remind_at: string;
  completed_at: string | null;
  notified_at: string | null;
}

export async function executeRemindersTool(
  input: Record<string, unknown>,
  userId: string,
  chatId: string | null = null,
): Promise<string> {
  const action = input.action as string;
  const adminSupabase = createServiceRoleClient();

  if (action === "create") {
    const content = input.content as string | undefined;
    const remindAt = input.remind_at as string | undefined;

    if (!content || !remindAt) {
      return JSON.stringify({ error: "content and remind_at are required" });
    }

    const { data, error } = await adminSupabase
      .from("reminders")
      .insert({ user_id: userId, content, remind_at: remindAt, ...(chatId ? { chat_id: chatId } : {}) })
      .select("id, content, remind_at")
      .single();

    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, reminder: data });
  }

  if (action === "list") {
    const { data, error } = await adminSupabase
      .from("reminders")
      .select("id, content, remind_at, completed_at, notified_at")
      .eq("user_id", userId)
      .is("completed_at", null)
      .order("remind_at", { ascending: true });

    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ reminders: (data ?? []) as ReminderRow[] });
  }

  if (action === "complete") {
    const id = input.id as string | undefined;
    if (!id) return JSON.stringify({ error: "id is required for complete" });

    const { error } = await adminSupabase
      .from("reminders")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true });
  }

  if (action === "snooze") {
    const id = input.id as string | undefined;
    const snoozeUntil = input.snooze_until as string | undefined;
    if (!id || !snoozeUntil) {
      return JSON.stringify({ error: "id and snooze_until are required for snooze" });
    }

    const { error } = await adminSupabase
      .from("reminders")
      .update({ remind_at: snoozeUntil, notified_at: null })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) return JSON.stringify({ error: error.message });
    return JSON.stringify({ success: true, snoozed_until: snoozeUntil });
  }

  return JSON.stringify({ error: `Unknown action: ${action}` });
}
