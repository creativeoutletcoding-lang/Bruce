import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  buildFamilyChatSystemPrompt,
} from "@/lib/anthropic";
import { notifyUser } from "@/lib/notifications";
import {
  CALENDAR_TOOLS,
  CALENDAR_SYSTEM_BLOCK,
  executeCalendarTool,
} from "@/lib/google/calendarTools";
import {
  SEARCH_TOOL,
  SEARCH_SYSTEM_BLOCK,
  executeSearchTool,
} from "@/lib/searchTools";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

// ── Bruce engagement logic (server-side, hard gate) ──────────────────────────
//
// Bruce responds ONLY when the current message directly addresses him.
// No engagement window — if nobody mentions Bruce, no Anthropic call is made.
// @mention (case-insensitive) or natural-language address ("Bruce, …") triggers.

function isDirectlyAddressed(message: string): boolean {
  return (
    /@bruce\b/i.test(message) ||
    /\bbruce\s*[,!?]|\bbruce\s+(can|could|please|help|tell|show|find|what|how|why|when|where|who)\b/i.test(
      message
    )
  );
}

function shouldBruceRespond(currentMessage: string): boolean {
  return isDirectlyAddressed(currentMessage);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { message: string; chatId: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { message, chatId } = body;

  if (!message?.trim()) return new Response("Message required", { status: 400 });
  if (!chatId) return new Response("chatId required", { status: 400 });

  const adminSupabase = createServiceRoleClient();

  // Load sender name
  const { data: senderProfile } = await adminSupabase
    .from("users")
    .select("name")
    .eq("id", user.id)
    .single();

  const senderName = senderProfile?.name ?? "Someone";

  // Load conversation history (before saving current message)
  const { data: msgs } = await adminSupabase
    .from("messages")
    .select("role, content, sender_id")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(40);

  const history = ((msgs ?? []).reverse()) as Array<{
    role: string;
    content: string;
    sender_id: string | null;
  }>;

  const willRespond = shouldBruceRespond(message);

  // Save user message
  const { error: msgErr } = await adminSupabase.from("messages").insert({
    chat_id: chatId,
    sender_id: user.id,
    role: "user",
    content: message,
  });

  if (msgErr) {
    console.error("[api/family/chat] Failed to insert user message:", msgErr);
  }

  // Update chat last_message_at
  adminSupabase
    .from("chats")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", chatId)
    .then();

  const [{ data: chatRow }, { data: memberRows }] = await Promise.all([
    adminSupabase.from("chats").select("type").eq("id", chatId).single(),
    adminSupabase.from("chat_members").select("user_id").eq("chat_id", chatId),
  ]);

  const notifUrl =
    (chatRow as { type: string } | null)?.type === "family_thread"
      ? `https://heybruce.app/family/threads/${chatId}`
      : "https://heybruce.app/family";

  const recipientIds = ((memberRows ?? []) as { user_id: string }[])
    .map((r) => r.user_id)
    .filter((id) => id !== user.id);

  console.log("[api/family/chat] notify — chatId:", chatId, "type:", (chatRow as { type: string } | null)?.type, "memberRows:", memberRows?.length ?? 0, "recipientIds:", recipientIds.length, recipientIds);

  const truncatedBody = message.length > 120 ? message.slice(0, 120) + "…" : message;

  await Promise.all(
    recipientIds.map((recipientId) =>
      notifyUser({
        userId: recipientId,
        senderId: user.id,
        title: senderName,
        body: truncatedBody,
        type: "message",
        url: notifUrl,
        suppressIfActiveInChatId: chatId,
      })
    )
  );

  if (!willRespond) {
    return new Response(null, {
      status: 200,
      headers: { "X-Bruce-Responded": "false" },
    });
  }

  // Load sender's memory for the system prompt
  const { block: memoryBlock, loadedIds } = await assembleMemoryBlock(
    supabase,
    user.id
  );

  if (loadedIds.length > 0) {
    supabase
      .from("memory")
      .update({ last_accessed: new Date().toISOString() })
      .in("id", loadedIds)
      .then();
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const systemPrompt =
    buildFamilyChatSystemPrompt(senderName, memoryBlock, dateStr, timeStr) +
    CALENDAR_SYSTEM_BLOCK +
    SEARCH_SYSTEM_BLOCK;

  const tools = [...CALENDAR_TOOLS, SEARCH_TOOL];
  console.log('tools loaded:', tools.map(t => t.name));
  console.log('system prompt includes search:', systemPrompt.includes('web_search'));

  const anthropicMessages: Anthropic.Messages.MessageParam[] = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user" as const, content: message },
  ];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const readableStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";

      try {
        let currentMessages = [...anthropicMessages];

        while (true) {
          const stream = anthropic.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools,
          });

          stream.on("text", (text) => {
            fullResponse += text;
            controller.enqueue(encoder.encode(text));
          });

          const finalMsg = await stream.finalMessage();

          if (finalMsg.stop_reason !== "tool_use") break;

          const toolCalls = finalMsg.content.filter(
            (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
          );
          if (toolCalls.length === 0) break;

          const toolResults = await Promise.all(
            toolCalls.map(async (tc) => {
              let result: string;
              try {
                if (tc.name === "web_search") {
                  result = await executeSearchTool(
                    tc.name,
                    tc.input as Record<string, unknown>
                  );
                } else {
                  result = await executeCalendarTool(
                    tc.name,
                    tc.input as Record<string, unknown>
                  );
                }
              } catch (err) {
                result = `Error: ${err instanceof Error ? err.message : String(err)}`;
              }
              return {
                type: "tool_result" as const,
                tool_use_id: tc.id,
                content: result,
              };
            })
          );

          currentMessages = [
            ...currentMessages,
            { role: "assistant" as const, content: finalMsg.content },
            { role: "user" as const, content: toolResults },
          ];
        }

        controller.close();
      } catch (err) {
        console.error("[api/family/chat] Stream error:", err);
        controller.error(err);
      } finally {
        if (fullResponse) {
          try {
            await adminSupabase.from("messages").insert({
              chat_id: chatId,
              sender_id: null,
              role: "assistant",
              content: fullResponse,
            });
            await adminSupabase
              .from("chats")
              .update({ last_message_at: new Date().toISOString() })
              .eq("id", chatId);
          } catch (dbErr) {
            console.error("[api/family/chat] Failed to persist Bruce message:", dbErr);
          }
        }
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      "X-Bruce-Responded": "true",
    },
  });
}
