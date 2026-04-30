import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  buildSystemPrompt,
  generateChatTitle,
} from "@/lib/anthropic";
import { CALENDAR_SYSTEM_BLOCK } from "@/lib/google/calendarTools";

type WithMCP = Anthropic.Messages.MessageStreamParams & {
  mcp_servers: Array<{ type: "url"; url: string; name: string }>;
};
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { message: string; chatId: string | null; isIncognito: boolean };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { message, chatId, isIncognito } = body;

  if (!message?.trim()) {
    return new Response("Message required", { status: 400 });
  }

  // Load memory
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

  // Load conversation history
  let history: Array<{ role: string; content: string }> = [];
  if (chatId) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("role, content")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    history = msgs ?? [];
  }

  // Build system prompt
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
  const systemPrompt = buildSystemPrompt(memoryBlock, dateStr, timeStr) + CALENDAR_SYSTEM_BLOCK;

  const adminSupabase = createServiceRoleClient();
  let currentChatId = chatId;
  let chatTitle: string | undefined;

  if (!isIncognito) {
    if (!currentChatId) {
      chatTitle = generateChatTitle(message);
      const { data: newChat, error: chatError } = await adminSupabase
        .from("chats")
        .insert({
          owner_id: user.id,
          project_id: null,
          type: "private",
          title: chatTitle,
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (chatError || !newChat) {
        console.error("[api/chat] Failed to create chat:", chatError);
        return new Response("Failed to create chat", { status: 500 });
      }
      currentChatId = newChat.id;
    }

    const { error: msgError } = await adminSupabase.from("messages").insert({
      chat_id: currentChatId,
      sender_id: user.id,
      role: "user",
      content: message,
    });

    if (msgError) {
      console.error("[api/chat] Failed to insert user message:", msgError);
    }
  }

  // Build Anthropic messages array
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

  const responseHeaders: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  };
  if (currentChatId) responseHeaders["X-Chat-Id"] = currentChatId;
  if (chatTitle) responseHeaders["X-Chat-Title"] = encodeURIComponent(chatTitle);

  const readableStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";

      try {
        const stream = anthropic.messages.stream(
          {
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system: systemPrompt,
            messages: anthropicMessages,
            mcp_servers: [
              {
                type: "url",
                url: "https://calendarmcp.googleapis.com/mcp/v1",
                name: "google-calendar",
              },
            ],
          } as WithMCP,
          { headers: { "anthropic-beta": "mcp-client-2025-04-04" } }
        );

        stream.on("text", (text) => {
          fullResponse += text;
          controller.enqueue(encoder.encode(text));
        });

        await stream.finalMessage();
        controller.close();
      } catch (err) {
        console.error("[api/chat] Stream error:", {
          model: "claude-sonnet-4-6",
          messageCount: anthropicMessages.length,
          error: err instanceof Error ? err.message : String(err),
        });
        controller.error(err);
      } finally {
        if (!isIncognito && currentChatId && fullResponse) {
          try {
            await adminSupabase.from("messages").insert({
              chat_id: currentChatId,
              sender_id: null,
              role: "assistant",
              content: fullResponse,
            });
            await adminSupabase
              .from("chats")
              .update({ last_message_at: new Date().toISOString() })
              .eq("id", currentChatId);
          } catch (dbErr) {
            console.error("[api/chat] Failed to persist assistant message:", dbErr);
          }
        }
      }
    },
  });

  return new Response(readableStream, { headers: responseHeaders });
}
