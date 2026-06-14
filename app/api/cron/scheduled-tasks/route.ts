import Anthropic from "@anthropic-ai/sdk";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assembleMemoryBlock, buildMemberCombination } from "@/lib/anthropic";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
import { runChatStream, TOOLS_FULL } from "@/lib/chat/streamHandler";
import { resolveModel } from "@/lib/models";
import { computeNextRunAt, type TaskSchedule } from "@/lib/scheduledTasks/schedule";
import { notifyUser } from "@/lib/notifications";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel native cron — fires every 5 minutes (vercel.json).
// Dispatches due standing tasks: each runs a full Bruce turn server-side as
// its owner (same runChatStream path as live chat — persistence, tool traces,
// and prompt caching all behave identically) and posts the result into the
// task's target chat. Idle invocations cost one indexed DB query.
//
// Privacy rule: a task runs as its owner and targets a chat its owner belongs
// to — it can never see or say anything the owner couldn't by hand.

const MAX_TASKS_PER_RUN = 5;

interface DueTask {
  id: string;
  user_id: string;
  chat_id: string;
  prompt: string;
  schedule: TaskSchedule;
  timezone: string;
  next_run_at: string;
}

function chatUrl(chat: { id: string; type: string; project_id: string | null }): string {
  if (chat.type === "family_group") return "https://heybruce.app/family";
  if (chat.type === "family_thread") return `https://heybruce.app/family/threads/${chat.id}`;
  if (chat.project_id) return `https://heybruce.app/projects/${chat.project_id}/chat/${chat.id}`;
  return `https://heybruce.app/chat/${chat.id}`;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const adminSupabase = createServiceRoleClient();

  const { data: due, error } = await adminSupabase
    .from("scheduled_tasks")
    .select("id, user_id, chat_id, prompt, schedule, timezone, next_run_at")
    .eq("enabled", true)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(MAX_TASKS_PER_RUN);

  if (error) {
    console.error("[cron/scheduled-tasks] fetch error:", error.message);
    return new Response("Error", { status: 500 });
  }
  if (!due || due.length === 0) return Response.json({ ran: 0 });

  let ran = 0;

  // Sequential on purpose — bounded model concurrency, and MAX_TASKS_PER_RUN
  // keeps the invocation inside maxDuration.
  for (const task of due as DueTask[]) {
    try {
      // Claim before running: advance next_run_at conditioned on the value we
      // read, so an overlapping invocation can never double-fire the task.
      let nextRunAt: string;
      try {
        nextRunAt = computeNextRunAt(task.schedule, task.timezone).toISOString();
      } catch {
        await adminSupabase
          .from("scheduled_tasks")
          .update({ enabled: false, last_error: "Invalid schedule — task disabled" })
          .eq("id", task.id);
        continue;
      }
      const { data: claimed } = await adminSupabase
        .from("scheduled_tasks")
        .update({ next_run_at: nextRunAt, last_run_at: new Date().toISOString(), last_error: null })
        .eq("id", task.id)
        .eq("next_run_at", task.next_run_at)
        .select("id");
      if (!claimed || claimed.length === 0) continue; // another invocation claimed it

      // Target chat must still exist and not be soft-deleted.
      const { data: chat } = await adminSupabase
        .from("chats")
        .select("id, type, project_id, deleted_at")
        .eq("id", task.chat_id)
        .maybeSingle();
      if (!chat || chat.deleted_at) {
        await adminSupabase
          .from("scheduled_tasks")
          .update({ enabled: false, last_error: "Target chat no longer exists — task disabled" })
          .eq("id", task.id);
        continue;
      }

      const { data: owner } = await adminSupabase
        .from("users")
        .select("name, home_location, preferred_model, preferred_effort")
        .eq("id", task.user_id)
        .single();
      const ownerProfile = owner as { name: string; home_location: string | null; preferred_model: string | null; preferred_effort: string | null } | null;
      const userName = ownerProfile?.name ?? "Member";
      const homeLocation = ownerProfile?.home_location ?? "Arlington, Virginia";
      const preferredModel = resolveModel(ownerProfile?.preferred_model).id;
      const preferredEffort = ownerProfile?.preferred_effort ?? null;

      // Family-type targets get family mode (group formatting + shared memory);
      // everything else runs as a standalone turn with private memory.
      const isFamily = chat.type === "family_group" || chat.type === "family_thread";
      let memberIds: string[] = [task.user_id];
      if (isFamily) {
        const { data: memberRows } = await adminSupabase
          .from("chat_members")
          .select("user_id")
          .eq("chat_id", task.chat_id);
        memberIds = ((memberRows ?? []) as { user_id: string }[]).map((r) => r.user_id);
      }
      const memberCombination = memberIds.length > 1 ? buildMemberCombination(memberIds) : undefined;

      const { block: memoryBlock } = await assembleMemoryBlock(adminSupabase, task.user_id, {
        memberCombination,
      });

      const userTimestamp = new Date().toLocaleString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
        timeZone: task.timezone,
      });

      const systemPrompt = buildSystemPrompt({
        mode: isFamily ? "family" : "standalone",
        userName,
        userTimestamp,
        memoryBlock,
        locationContext: `${userName}'s home location is ${homeLocation}. Use this as the default for any location-based questions.`,
        scheduledTaskContext: `## Scheduled task run

This is an automated standing-task run on behalf of ${userName} — no member is live in the chat right now. The task instruction below is your entire input: execute it completely with your tools and post the result as a normal message. Do not ask clarifying questions (nobody is present to answer); do the best complete job possible. If a tool fails, say briefly what you couldn't get instead of failing silently. Do not create or modify reminders or scheduled tasks unless the instruction explicitly says to.`,
        includeImageGen: false,
      });

      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultHeaders: { "anthropic-beta": "files-api-2025-04-14" },
      });

      // Capture Bruce's final text for the FCM preview.
      let responseText = "";

      const stream = runChatStream({
        anthropic,
        model: preferredModel,
        effort: preferredEffort,
        maxTokens: 16000,
        systemPrompt,
        initialMessages: [
          { role: "user", content: `[Automated scheduled task run]\n\n${task.prompt}` },
        ],
        tools: TOOLS_FULL,
        userId: task.user_id,
        handleImageRequest: false,
        persist: {
          enabled: true,
          adminSupabase,
          chatId: task.chat_id,
          latestUserMessageId: null,
        },
        searchContext: { projectId: chat.project_id as string | null },
        onComplete: async (text) => { responseText = text; },
      });

      // Drain the stream — persistence happens inside runChatStream.
      const reader = stream.getReader();
      while (!(await reader.read()).done) { /* drain */ }

      if (responseText) {
        const body = responseText.length > 120 ? responseText.slice(0, 120) + "…" : responseText;
        const url = chatUrl(chat as { id: string; type: string; project_id: string | null });
        const recipients = isFamily ? memberIds : [task.user_id];
        await Promise.all(
          recipients.map((recipientId) =>
            notifyUser({
              userId: recipientId,
              title: "Bruce",
              body,
              type: "message",
              category: "bruce_response",
              url,
              metadata: { scheduledTaskId: task.id },
            })
          )
        );
        ran++;
      } else {
        await adminSupabase
          .from("scheduled_tasks")
          .update({ last_error: "Run produced no output" })
          .eq("id", task.id);
      }
    } catch (err) {
      console.error(`[cron/scheduled-tasks] task ${task.id} failed:`, err);
      // next_run_at was already advanced at claim time — no retry storm.
      await adminSupabase
        .from("scheduled_tasks")
        .update({ last_error: err instanceof Error ? err.message.slice(0, 500) : "Unknown error" })
        .eq("id", task.id)
        .then(undefined, () => {});
    }
  }

  return Response.json({ ran });
}
