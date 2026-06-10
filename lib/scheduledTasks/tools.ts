import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  computeNextRunAt,
  describeSchedule,
  validateSchedule,
  type TaskSchedule,
} from "@/lib/scheduledTasks/schedule";

const DEFAULT_TIMEZONE = process.env.FAMILY_CALENDAR_TIMEZONE ?? "America/New_York";

export const SCHEDULED_TASKS_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "manage_scheduled_tasks",
    description: `Manage the current user's standing tasks — recurring work Bruce performs automatically on a schedule, posting the result into this chat. Use for "every morning at 7 send me a briefing", "every Sunday at 5 summarize the week ahead", "first of the month pull the revenue numbers". For a one-time notification at a specific time, use manage_reminders instead.

Actions:
- create: Add a standing task. Create immediately when the request is explicit (recurrence + time + what to do); ask one clarifying question if the schedule is ambiguous. Acknowledge with the schedule in plain words: "Done — every Sunday at 5 PM I'll post the week ahead here."
- list: Retrieve the user's standing tasks. Present conversationally.
- update: Change a task's prompt, schedule, or enabled state by ID.
- delete: Remove a task by ID.`,
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "update", "delete"],
          description: "Operation to perform",
        },
        prompt: {
          type: "string",
          description:
            "Instruction Bruce executes on each run. Write it as a self-contained instruction to your future self — it runs with no other conversation context. Required for create.",
        },
        schedule: {
          type: "object",
          description:
            'Recurrence rule. {type: "daily"|"weekly"|"monthly", time: "HH:MM" 24-hour local wall time, weekday?: 0-6 (0=Sunday, weekly only), day?: 1-31 (monthly only; months lacking the day are skipped)}. Required for create.',
          properties: {
            type: { type: "string", enum: ["daily", "weekly", "monthly"] },
            time: { type: "string" },
            weekday: { type: "number" },
            day: { type: "number" },
          },
          required: ["type", "time"],
        },
        timezone: {
          type: "string",
          description: `IANA timezone for the schedule's wall-clock time. Defaults to ${DEFAULT_TIMEZONE}.`,
        },
        id: {
          type: "string",
          description: "Task UUID. Required for update or delete.",
        },
        enabled: {
          type: "boolean",
          description: "Pause (false) or resume (true) a task. Used with update.",
        },
      },
      required: ["action"],
    },
  },
];

export const SCHEDULED_TASKS_SYSTEM_BLOCK = `

## Scheduled tasks (standing tasks)

Use manage_scheduled_tasks for recurring work you should perform automatically — the result posts into the current chat on each run. "Every morning…", "every Sunday…", "first of the month…" plus an action means a scheduled task. A one-time "remind me at 3" is manage_reminders, not this.

- The stored prompt runs with no conversation context — write it as a complete instruction to your future self, including what to check, what tools to use, and how to present the result.
- Morning briefing requests ("send me a briefing every morning at 7"): store a prompt that covers today's family calendar events, the user's pending reminders, the weather for their location, and anything time-sensitive — concise, scannable, warm.
- Create immediately when recurrence, time, and action are all clear. Confirm the schedule in plain words after creating. If the schedule is ambiguous, ask one question first.
- Listing: conversational, never raw IDs or JSON. Pausing, resuming, and deleting are low stakes — act and confirm in one sentence.`;

interface TaskRow {
  id: string;
  prompt: string;
  schedule: TaskSchedule;
  timezone: string;
  next_run_at: string;
  enabled: boolean;
  created_at: string;
}

export async function executeScheduledTasksTool(
  input: Record<string, unknown>,
  userId: string,
  chatId: string | null
): Promise<string> {
  const action = typeof input.action === "string" ? input.action : "";
  const serviceRole = createServiceRoleClient();

  if (action === "create") {
    if (!chatId) {
      return "Error: scheduled tasks are not available in incognito chats.";
    }
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt) return "Error: prompt is required to create a scheduled task.";
    const schedule = input.schedule as TaskSchedule | undefined;
    const schedErr = validateSchedule(schedule);
    if (schedErr) return `Error: ${schedErr}`;
    const timezone = typeof input.timezone === "string" && input.timezone ? input.timezone : DEFAULT_TIMEZONE;

    let nextRunAt: Date;
    try {
      nextRunAt = computeNextRunAt(schedule!, timezone);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : "invalid schedule or timezone"}`;
    }

    const { data, error } = await serviceRole
      .from("scheduled_tasks")
      .insert({
        user_id: userId,
        chat_id: chatId,
        prompt,
        schedule,
        timezone,
        next_run_at: nextRunAt.toISOString(),
        enabled: true,
      })
      .select("id")
      .single();
    if (error || !data) return `Error: failed to create scheduled task — ${error?.message ?? "unknown"}`;

    return JSON.stringify({
      id: data.id,
      schedule_description: describeSchedule(schedule!),
      next_run_at: nextRunAt.toISOString(),
    });
  }

  if (action === "list") {
    const { data, error } = await serviceRole
      .from("scheduled_tasks")
      .select("id, prompt, schedule, timezone, next_run_at, enabled, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) return `Error: failed to list scheduled tasks — ${error.message}`;
    const tasks = ((data ?? []) as TaskRow[]).map((t) => ({
      id: t.id,
      prompt: t.prompt,
      schedule_description: describeSchedule(t.schedule),
      next_run_at: t.next_run_at,
      enabled: t.enabled,
    }));
    return JSON.stringify({ tasks });
  }

  if (action === "update") {
    const id = typeof input.id === "string" ? input.id : "";
    if (!id) return "Error: id is required for update.";

    const { data: existing, error: fetchErr } = await serviceRole
      .from("scheduled_tasks")
      .select("id, schedule, timezone")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (fetchErr || !existing) return "Error: scheduled task not found.";

    const updates: Record<string, unknown> = {};
    if (typeof input.prompt === "string" && input.prompt.trim()) updates.prompt = input.prompt.trim();
    if (typeof input.enabled === "boolean") updates.enabled = input.enabled;

    const newSchedule = input.schedule as TaskSchedule | undefined;
    const newTimezone = typeof input.timezone === "string" && input.timezone ? input.timezone : undefined;
    if (newSchedule || newTimezone) {
      const schedule = newSchedule ?? (existing.schedule as TaskSchedule);
      const schedErr = validateSchedule(schedule);
      if (schedErr) return `Error: ${schedErr}`;
      const timezone = newTimezone ?? (existing.timezone as string);
      try {
        updates.schedule = schedule;
        updates.timezone = timezone;
        updates.next_run_at = computeNextRunAt(schedule, timezone).toISOString();
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : "invalid schedule or timezone"}`;
      }
    }

    if (Object.keys(updates).length === 0) return "Error: nothing to update.";

    const { error } = await serviceRole
      .from("scheduled_tasks")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId);
    if (error) return `Error: failed to update scheduled task — ${error.message}`;
    return JSON.stringify({ id, updated: Object.keys(updates) });
  }

  if (action === "delete") {
    const id = typeof input.id === "string" ? input.id : "";
    if (!id) return "Error: id is required for delete.";
    const { error } = await serviceRole
      .from("scheduled_tasks")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) return `Error: failed to delete scheduled task — ${error.message}`;
    return JSON.stringify({ id, deleted: true });
  }

  return `Error: unknown action "${action}".`;
}
