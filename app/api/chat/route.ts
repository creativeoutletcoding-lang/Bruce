import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  buildSystemPrompt,
  generateChatTitle,
  IMAGE_SYSTEM_BLOCK,
  IMAGE_VISION_BLOCK,
} from "@/lib/anthropic";
import {
  CALENDAR_TOOLS,
  CALENDAR_SYSTEM_BLOCK,
  executeCalendarTool,
} from "@/lib/google/calendarTools";
import {
  SEARCH_TOOL,
  SEARCH_SYSTEM_BLOCK,
  SEARCH_STATUS_SENTINEL,
  executeSearchTool,
} from "@/lib/searchTools";
import { type ImageQuality } from "@/lib/images/generate";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { message: string; chatId: string | null; isIncognito: boolean; currentLocation?: string; userTimestamp?: string; image?: { base64: string; mediaType: string }; document?: { base64: string; mediaType: string; filename: string } };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { message, chatId, isIncognito, currentLocation, userTimestamp: rawTimestamp, image, document } = body;
  const userTimestamp = rawTimestamp ?? new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  if (image) {
    console.log('[api/chat] image attachment: mediaType=%s base64Length=%d', image.mediaType, image.base64?.length ?? 0);
  }
  if (document) {
    console.log('[api/chat] document attachment: filename=%s mediaType=%s base64Length=%d', document.filename, document.mediaType, document.base64?.length ?? 0);
  }

  if (!message?.trim() && !image && !document) {
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

  // Load conversation history — replace image messages with a brief note
  let history: Array<{ role: string; content: string }> = [];
  if (chatId) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("role, content, metadata")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    history = (msgs ?? []).map((m) => {
      const meta = m.metadata as Record<string, unknown> | null;
      return {
        role: m.role as string,
        content: meta?.content_type === "image" ? "[image generated]" : (m.content as string),
      };
    });
  }

  // Fetch user profile for name, home location, and preferred model
  const { data: userProfile } = await supabase
    .from("users")
    .select("name, home_location, preferred_model")
    .eq("id", user.id)
    .single();
  const userName = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.name ?? "Member";
  const homeLocation = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.home_location ?? "Arlington, Virginia";
  const preferredModel = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.preferred_model ?? "claude-sonnet-4-6";

  // Build system prompt
  const locationContext = currentLocation
    ? `${userName}'s current location right now is ${currentLocation}.`
    : `${userName}'s home location is ${homeLocation}. Use this as the default for any location-based questions.`;

  const systemPrompt =
    buildSystemPrompt(userName, memoryBlock, userTimestamp) +
    `\n\n${locationContext}` +
    CALENDAR_SYSTEM_BLOCK +
    IMAGE_SYSTEM_BLOCK +
    IMAGE_VISION_BLOCK +
    SEARCH_SYSTEM_BLOCK;

  const tools = [...CALENDAR_TOOLS, SEARCH_TOOL];
  console.log('tools loaded:', tools.map(t => t.name));
  console.log('system prompt includes search:', systemPrompt.includes('web_search'));

  const adminSupabase = createServiceRoleClient();
  let currentChatId = chatId;
  let chatTitle: string | undefined;

  let userImageUrl: string | undefined;
  if (image && !isIncognito) {
    try {
      const fileExt = image.mediaType.split("/")[1] ?? "jpg";
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;
      const { error: uploadErr } = await adminSupabase.storage
        .from("message-images")
        .upload(filePath, Buffer.from(image.base64, "base64"), {
          contentType: image.mediaType,
          upsert: false,
        });
      if (!uploadErr) {
        const { data: urlData } = adminSupabase.storage
          .from("message-images")
          .getPublicUrl(filePath);
        userImageUrl = urlData.publicUrl;
      }
    } catch { /* non-fatal — message still sends */ }
  }

  let userDocUrl: string | undefined;
  if (document && !isIncognito) {
    try {
      const fileExt = document.filename.split(".").pop() ?? "bin";
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;
      const { error: uploadErr } = await adminSupabase.storage
        .from("message-images")
        .upload(filePath, Buffer.from(document.base64, "base64"), {
          contentType: document.mediaType,
          upsert: false,
        });
      if (!uploadErr) {
        const { data: urlData } = adminSupabase.storage
          .from("message-images")
          .getPublicUrl(filePath);
        userDocUrl = urlData.publicUrl;
      }
    } catch { /* non-fatal — message still sends */ }
  }

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
      image_url: userImageUrl ?? userDocUrl ?? null,
      attachment_type: image ? "image" : document ? "document" : null,
      attachment_filename: document?.filename ?? null,
    });

    if (msgError) {
      console.error("[api/chat] Failed to insert user message:", msgError);
    }
  }

  console.log('[api/chat] building content block — hasImage=%s hasDocument=%s messageLen=%d', !!image, !!document, message.length);

  let userContent: Anthropic.Messages.MessageParam["content"];
  try {
    userContent = image
      ? [
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: image.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: image.base64,
            },
          },
          ...(message.trim() ? [{ type: "text" as const, text: message }] : []),
        ]
      : document
      ? [
          {
            type: "document" as const,
            source: document.mediaType === "application/pdf"
              ? { type: "base64" as const, media_type: "application/pdf" as const, data: document.base64 }
              : { type: "text" as const, media_type: "text/plain" as const, data: document.base64 },
            title: document.filename,
          },
          ...(message.trim() ? [{ type: "text" as const, text: message }] : []),
        ]
      : message;
  } catch (contentErr) {
    console.error('[api/chat] content block construction failed:', contentErr);
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

  const responseHeaders: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  };
  if (currentChatId) responseHeaders["X-Chat-Id"] = currentChatId;
  if (chatTitle) responseHeaders["X-Chat-Title"] = encodeURIComponent(chatTitle);

  const IMAGE_TAG_RE = /<image_request>([\s\S]*?)<\/image_request>/;

  const readableStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";
      // Lookahead buffer to prevent streaming the <image_request> tag to the client
      let pending = "";

      function flushPending() {
        if (!pending) return;
        // Strip any image_request tag that landed in pending before flushing
        const clean = pending.replace(/<image_request>[\s\S]*?<\/image_request>/g, "").trimStart();
        if (clean) controller.enqueue(encoder.encode(clean));
        pending = "";
      }

      function handleText(text: string) {
        pending += text;
        // Keep buffering until we're sure no partial tag is being formed
        // A partial tag starts with '<' and could be growing — hold the last 32 chars
        const tagStart = pending.indexOf("<image_request>");
        if (tagStart !== -1) {
          // Flush everything before the tag start immediately
          if (tagStart > 0) {
            controller.enqueue(encoder.encode(pending.slice(0, tagStart)));
          }
          // Keep the tag portion buffered until the closing tag arrives
          pending = pending.slice(tagStart);
          const tagEnd = pending.indexOf("</image_request>");
          if (tagEnd !== -1) {
            // Full tag present — swallow it, flush what comes after
            const after = pending.slice(tagEnd + "</image_request>".length);
            pending = "";
            if (after.trimStart()) controller.enqueue(encoder.encode(after.trimStart()));
          }
          // else: still waiting for closing tag — keep buffering
        } else {
          // No tag start; safe to flush all but the last 15 chars (boundary safety)
          const safe = pending.length > 15 ? pending.length - 15 : 0;
          if (safe > 0) {
            controller.enqueue(encoder.encode(pending.slice(0, safe)));
            pending = pending.slice(safe);
          }
        }
      }

      try {
        let currentMessages = [...anthropicMessages];
        console.log('[api/chat] anthropic call starting — model=%s messages=%d', preferredModel, currentMessages.length);

        while (true) {
          const stream = anthropic.messages.stream({
            model: preferredModel,
            max_tokens: 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools,
          });

          stream.on("text", (text) => {
            fullResponse += text;
            handleText(text);
          });

          const finalMsg = await stream.finalMessage();

          if (finalMsg.stop_reason !== "tool_use") break;

          const toolCalls = finalMsg.content.filter(
            (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
          );
          if (toolCalls.length === 0) break;

          if (toolCalls.some((tc) => tc.name === "web_search")) {
            controller.enqueue(encoder.encode(SEARCH_STATUS_SENTINEL));
          }

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

        // Flush any remaining buffered text
        flushPending();

        // Detect image request — pass prompt back to client to fetch separately
        const imageMatch = IMAGE_TAG_RE.exec(fullResponse);
        if (imageMatch && !isIncognito && currentChatId) {
          try {
            const tagContent = JSON.parse(imageMatch[1]) as { prompt: string; quality?: ImageQuality };
            controller.enqueue(
              encoder.encode(`\x1fIMAGE_REQ:${JSON.stringify({ prompt: tagContent.prompt, quality: tagContent.quality ?? "standard", chatId: currentChatId })}`)
            );
          } catch {
            // Malformed tag — ignore
          }
        }

        controller.close();
      } catch (err) {
        console.error("[api/chat] Stream error:", {
          model: preferredModel,
          messageCount: anthropicMessages.length,
          error: err instanceof Error ? err.message : String(err),
        });
        controller.error(err);
      } finally {
        if (!isIncognito && currentChatId && fullResponse) {
          // Strip image tag before saving to DB
          const cleanResponse = fullResponse
            .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
            .trim();
          if (cleanResponse) {
            try {
              await adminSupabase.from("messages").insert({
                chat_id: currentChatId,
                sender_id: null,
                role: "assistant",
                content: cleanResponse,
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
      }
    },
  });

  return new Response(readableStream, { headers: responseHeaders });
}
