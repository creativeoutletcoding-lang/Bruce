import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  buildFamilyChatSystemPrompt,
  IMAGE_VISION_BLOCK,
} from "@/lib/anthropic";
import { notifyUser } from "@/lib/notifications";
import {
  CALENDAR_TOOLS,
  CALENDAR_SYSTEM_BLOCK,
  executeCalendarTool,
} from "@/lib/google/calendarTools";
import {
  GMAIL_TOOLS,
  GMAIL_TOOL_NAMES,
  GMAIL_SYSTEM_BLOCK,
  executeGmailTool,
} from "@/lib/google/gmailTools";
import {
  SEARCH_TOOL,
  SEARCH_SYSTEM_BLOCK,
  executeSearchTool,
} from "@/lib/searchTools";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

// ── Bruce engagement logic (server-side, hard gate) ──────────────────────────
//
// Bruce responds when:
//   1. His name appears anywhere in the message (beginning, middle, or end), or
//   2. His last message in the chat was a question (the reply is directed at him).

function isDirectlyAddressed(message: string): boolean {
  // \b matches the word boundary before "bruce" regardless of position or surrounding
  // punctuation, so "Bruce", "Bruce,", "@Bruce", "asking Bruce", "Bruce?" all match.
  return /\bbruce\b/i.test(message);
}

function bruceAskedQuestion(history: Array<{ role: string; content: string }>): boolean {
  if (history.length === 0) return false;
  const last = history[history.length - 1];
  return last.role === "assistant" && last.content.includes("?");
}

function shouldBruceRespond(
  currentMessage: string,
  history: Array<{ role: string; content: string }>
): boolean {
  return isDirectlyAddressed(currentMessage) || bruceAskedQuestion(history);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { message: string; chatId: string; currentLocation?: string; userTimestamp?: string; attachments?: Array<{ base64: string; mediaType: string; filename: string; type: "image" | "document" }> };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { message, chatId, currentLocation, userTimestamp: rawTimestamp, attachments: rawAttachments } = body;
  const attachments = rawAttachments ?? [];
  const userTimestamp = rawTimestamp ?? new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  if (!message?.trim() && attachments.length === 0) return new Response("Message required", { status: 400 });
  if (!chatId) return new Response("chatId required", { status: 400 });

  const adminSupabase = createServiceRoleClient();

  // Load sender name and home location
  const { data: senderProfile } = await adminSupabase
    .from("users")
    .select("name, home_location")
    .eq("id", user.id)
    .single();

  const senderName = (senderProfile as { name: string; home_location: string | null } | null)?.name ?? "Someone";
  const homeLocation = (senderProfile as { name: string; home_location: string | null } | null)?.home_location ?? "Arlington, Virginia";

  // Load conversation history (before saving current message)
  const { data: msgs } = await adminSupabase
    .from("messages")
    .select("role, content, sender_id, metadata")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(40);

  const history = ((msgs ?? []).reverse() as Array<{
    role: string;
    content: string;
    sender_id: string | null;
    metadata: Record<string, unknown> | null;
  }>).map((m) => {
    const text = m.content ?? "";
    const metaAttachments = m.metadata?.attachments as Array<{ type: string; filename?: string }> | undefined;
    if (metaAttachments && metaAttachments.length > 0 && !text.trim()) {
      const desc = metaAttachments
        .map((a) => a.type === "document" ? `[document: ${a.filename ?? "file"}]` : "[image]")
        .join(", ");
      return { role: m.role, content: desc, sender_id: m.sender_id };
    }
    return { role: m.role, content: text, sender_id: m.sender_id };
  }).filter((m) => m.content.trim().length > 0);

  const willRespond = shouldBruceRespond(message, history);

  // Upload attachments to storage
  const attachmentMeta: Array<{ url: string; type: string; filename?: string }> = [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    try {
      const fileExt = att.type === "image"
        ? (att.mediaType.split("/")[1] ?? "jpg")
        : (att.filename.split(".").pop() ?? "bin");
      const filePath = `${user.id}/${Date.now()}_${i}.${fileExt}`;
      const { error: uploadErr } = await adminSupabase.storage
        .from("message-images")
        .upload(filePath, Buffer.from(att.base64, "base64"), {
          contentType: att.mediaType,
          upsert: false,
        });
      if (!uploadErr) {
        const { data: urlData } = adminSupabase.storage.from("message-images").getPublicUrl(filePath);
        attachmentMeta.push({ url: urlData.publicUrl, type: att.type, filename: att.type === "document" ? att.filename : undefined });
      } else {
        attachmentMeta.push({ url: "", type: att.type, filename: att.type === "document" ? att.filename : undefined });
      }
    } catch {
      attachmentMeta.push({ url: "", type: att.type, filename: att.type === "document" ? att.filename : undefined });
    }
  }

  // Save user message
  const firstAtt = attachments[0];
  const firstDocFilename = attachments.find((a) => a.type === "document")?.filename ?? null;
  const { error: msgErr } = await adminSupabase.from("messages").insert({
    chat_id: chatId,
    sender_id: user.id,
    role: "user",
    content: message,
    image_url: attachmentMeta[0]?.url ?? null,
    attachment_type: firstAtt?.type ?? null,
    attachment_filename: firstDocFilename,
    ...(attachmentMeta.length > 0 ? { metadata: { attachments: attachmentMeta } } : {}),
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

  const notifText = message.trim() || (attachments.length > 0 ? `Sent ${attachments.length === 1 ? "a file" : `${attachments.length} files`}` : "");
  const truncatedBody = notifText.length > 120 ? notifText.slice(0, 120) + "…" : notifText;

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

  const locationContext = currentLocation
    ? `${senderName}'s current location right now is ${currentLocation}.`
    : `${senderName}'s home location is ${homeLocation}. Use this as the default for any location-based questions.`;

  const systemPrompt =
    buildFamilyChatSystemPrompt(senderName, memoryBlock, userTimestamp) +
    `\n\n${locationContext}` +
    CALENDAR_SYSTEM_BLOCK +
    GMAIL_SYSTEM_BLOCK +
    IMAGE_VISION_BLOCK +
    SEARCH_SYSTEM_BLOCK;

  const tools = [...CALENDAR_TOOLS, ...GMAIL_TOOLS, SEARCH_TOOL];

  let userContent: Anthropic.Messages.MessageParam["content"];
  try {
    if (attachments.length > 0) {
      const blocks: Array<
        | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
        | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } | { type: "text"; media_type: "text/plain"; data: string }; title: string }
        | { type: "text"; text: string }
      > = [];
      for (const att of attachments) {
        if (att.type === "image") {
          blocks.push({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: att.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: att.base64,
            },
          });
        } else {
          blocks.push({
            type: "document" as const,
            source: att.mediaType === "application/pdf"
              ? { type: "base64" as const, media_type: "application/pdf" as const, data: att.base64 }
              : { type: "text" as const, media_type: "text/plain" as const, data: att.base64 },
            title: att.filename,
          });
        }
      }
      if (message.trim()) blocks.push({ type: "text" as const, text: message });
      userContent = blocks as Anthropic.Messages.MessageParam["content"];
    } else {
      userContent = message;
    }
  } catch (contentErr) {
    console.error('[api/family/chat] content block construction failed:', contentErr);
    return new Response("Content processing failed", { status: 500 });
  }

  const anthropicMessages: Anthropic.Messages.MessageParam[] = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user" as const, content: userContent },
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
                } else if (GMAIL_TOOL_NAMES.has(tc.name)) {
                  result = await executeGmailTool(
                    tc.name,
                    tc.input as Record<string, unknown>,
                    user.id
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

        // Persist before close — Vercel may terminate the function once the
        // stream ends, so the write must complete while the connection is open.
        if (fullResponse) {
          const { error: insertErr } = await adminSupabase.from("messages").insert({
            chat_id: chatId,
            sender_id: null,
            role: "assistant",
            content: fullResponse,
          });
          if (insertErr) {
            console.error("[api/family/chat] Failed to persist Bruce message:", insertErr);
          } else {
            const { error: updateErr } = await adminSupabase
              .from("chats")
              .update({ last_message_at: new Date().toISOString() })
              .eq("id", chatId);
            if (updateErr) {
              console.error("[api/family/chat] Failed to update chat timestamp:", updateErr);
            }
          }
        }

        controller.close();
      } catch (err) {
        console.error("[api/family/chat] Stream error:", err);
        // Best-effort: save any partial response received before the error
        if (fullResponse) {
          const { error: insertErr } = await adminSupabase.from("messages").insert({
            chat_id: chatId,
            sender_id: null,
            role: "assistant",
            content: fullResponse,
          });
          if (insertErr) {
            console.error("[api/family/chat] Failed to persist partial Bruce message:", insertErr);
          }
        }
        controller.error(err);
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
