import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  buildFamilyChatSystemPrompt,
} from "@/lib/anthropic";
import { notifyUser, extractMentionedUserIds } from "@/lib/notifications";
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

  // Await mention notifications before returning — fire-and-forget is killed by
  // Vercel when the response is sent before the promise resolves.
  const mentionedIds = await extractMentionedUserIds(message, user.id);
  await Promise.all(
    mentionedIds.map((recipientId) =>
      notifyUser({
        userId: recipientId,
        senderId: user.id,
        title: `${senderName} mentioned you`,
        body: message.length > 120 ? message.slice(0, 120) + "…" : message,
        type: "mention",
        url: "https://heybruce.app/family",
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

  const systemPrompt = buildFamilyChatSystemPrompt(
    senderName,
    memoryBlock,
    dateStr,
    timeStr
  );

  const anthropicMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user", content: message },
  ];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let fullResponse = "";

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        const stream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          system: systemPrompt,
          messages: anthropicMessages,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const text = event.delta.text;
            fullResponse += text;
            controller.enqueue(new TextEncoder().encode(text));
          }
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
