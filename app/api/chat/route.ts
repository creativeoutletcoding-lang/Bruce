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
  GMAIL_TOOLS,
  GMAIL_TOOL_NAMES,
  GMAIL_SYSTEM_BLOCK,
  executeGmailTool,
} from "@/lib/google/gmailTools";
import {
  SEARCH_TOOL,
  SEARCH_SYSTEM_BLOCK,
  SEARCH_STATUS_SENTINEL,
  BROWSE_TOOL,
  BROWSE_SYSTEM_BLOCK,
  BROWSE_STATUS_SENTINEL,
  executeSearchTool,
} from "@/lib/searchTools";
import {
  DOCUMENT_TOOLS,
  DOCUMENT_TOOL_NAMES,
  DOCUMENT_SYSTEM_BLOCK,
  DOCUMENT_STATUS_SENTINEL,
  executeDocumentTool,
} from "@/lib/documents/documentTools";
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

  let body: { message: string; chatId: string | null; isIncognito: boolean; currentLocation?: string; userTimestamp?: string; attachments?: Array<{ file_id: string | null; url: string; type: "image" | "document"; filename: string }> };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { message, chatId, isIncognito, currentLocation, userTimestamp: rawTimestamp, attachments: rawAttachments } = body;
  const attachments = rawAttachments ?? [];
  const userTimestamp = rawTimestamp ?? new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  if (!message?.trim() && attachments.length === 0) {
    return new Response("Message required", { status: 400 });
  }

  // Load memory
  const { block: memoryBlock } = await assembleMemoryBlock(
    supabase,
    user.id
  );

  // Load conversation history — use file_ids for attachment references when available
  type HistoryEntry = { role: string; content: string | Anthropic.Messages.ContentBlockParam[] };
  let history: HistoryEntry[] = [];
  if (chatId) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("role, content, metadata, file_ids")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    history = (msgs ?? []).map((m) => {
      const meta = m.metadata as Record<string, unknown> | null;
      if (meta?.content_type === "image") {
        return { role: m.role as string, content: "[image generated]" };
      }
      const text = (m.content as string) ?? "";
      const metaAttachments = meta?.attachments as Array<{ type: string; filename?: string }> | undefined;
      const fileIds = m.file_ids as (string | null)[] | null;

      // Reconstruct content blocks from stored file_ids
      if (fileIds && fileIds.length > 0 && metaAttachments && metaAttachments.length > 0) {
        const blocks: Anthropic.Messages.ContentBlockParam[] = [];
        for (let i = 0; i < fileIds.length; i++) {
          const fileId = fileIds[i];
          const att = metaAttachments[i];
          if (!fileId || !att) continue;
          if (att.type === "image") {
            blocks.push({ type: "image", source: { type: "file", file_id: fileId } } as unknown as Anthropic.Messages.ContentBlockParam);
          } else {
            blocks.push({ type: "document", source: { type: "file", file_id: fileId }, title: att.filename ?? "document" } as unknown as Anthropic.Messages.ContentBlockParam);
          }
        }
        if (text.trim()) blocks.push({ type: "text", text });
        if (blocks.length > 0) return { role: m.role as string, content: blocks };
      }

      // Fallback: text placeholder for messages without file_ids
      if (metaAttachments && metaAttachments.length > 0 && !text.trim()) {
        const desc = metaAttachments
          .map((a) => a.type === "document" ? `[document: ${a.filename ?? "file"}]` : "[image]")
          .join(", ");
        return { role: m.role as string, content: desc };
      }
      return { role: m.role as string, content: text };
    }).filter((m) => {
      const c = m.content;
      return typeof c === "string" ? c.trim().length > 0 : Array.isArray(c) && c.length > 0;
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
    GMAIL_SYSTEM_BLOCK +
    IMAGE_SYSTEM_BLOCK +
    IMAGE_VISION_BLOCK +
    SEARCH_SYSTEM_BLOCK +
    BROWSE_SYSTEM_BLOCK +
    DOCUMENT_SYSTEM_BLOCK;

  const tools = [...CALENDAR_TOOLS, ...GMAIL_TOOLS, SEARCH_TOOL, BROWSE_TOOL, ...DOCUMENT_TOOLS];

  const adminSupabase = createServiceRoleClient();
  let currentChatId = chatId;
  let chatTitle: string | undefined;

  // Attachments are pre-uploaded via /api/files/upload before this request is sent.
  // file_id comes from the Anthropic Files API; url comes from Supabase storage.
  const attachmentMeta = attachments.map((att) => ({
    url: att.url,
    type: att.type,
    filename: att.type === "document" ? att.filename : undefined,
  }));
  const fileIds = attachments.map((att) => att.file_id);

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

    const firstAtt = attachments[0];
    const firstDocFilename = attachments.find((a) => a.type === "document")?.filename ?? null;
    const hasFileIds = fileIds.some(Boolean);
    const { error: msgError } = await adminSupabase.from("messages").insert({
      chat_id: currentChatId,
      sender_id: user.id,
      role: "user",
      content: message,
      image_url: attachmentMeta[0]?.url ?? null,
      attachment_type: firstAtt?.type ?? null,
      attachment_filename: firstDocFilename,
      ...(attachmentMeta.length > 0 ? { metadata: { attachments: attachmentMeta } } : {}),
      ...(hasFileIds ? { file_ids: fileIds } : {}),
    });

    if (msgError) {
      console.error("[api/chat] Failed to insert user message:", msgError);
    }
  }

  let userContent: Anthropic.Messages.MessageParam["content"];
  if (attachments.length > 0) {
    const blocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const att of attachments) {
      if (!att.file_id) continue;
      if (att.type === "image") {
        blocks.push({ type: "image", source: { type: "file", file_id: att.file_id } } as unknown as Anthropic.Messages.ContentBlockParam);
      } else {
        blocks.push({ type: "document", source: { type: "file", file_id: att.file_id }, title: att.filename } as unknown as Anthropic.Messages.ContentBlockParam);
      }
    }
    if (message.trim()) blocks.push({ type: "text" as const, text: message });
    if (blocks.length === 0) blocks.push({ type: "text" as const, text: message || "[attachment]" });
    userContent = blocks as Anthropic.Messages.MessageParam["content"];
  } else {
    userContent = message;
  }

  const anthropicMessages: Anthropic.Messages.MessageParam[] = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as Anthropic.Messages.MessageParam["content"],
      })),
    { role: "user" as const, content: userContent },
  ];

  // Files API beta header needed so Anthropic recognises { type:"file" } sources
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": "files-api-2025-04-14" },
  });

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
      let currentTurnText = "";
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
        let webSearchUsed = false;
        let browseUrlUsed = false;

        while (true) {
          currentTurnText = "";

          const stream = anthropic.messages.stream({
            model: preferredModel,
            max_tokens: 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools,
          });

          stream.on("text", (text) => {
            fullResponse += text;
            currentTurnText += text;
            handleText(text);
          });

          const finalMsg = await stream.finalMessage();

          if (finalMsg.stop_reason !== "tool_use") break;

          // Save this turn's text immediately before executing tools
          if (!isIncognito && currentChatId && currentTurnText.trim()) {
            const cleanTurnText = currentTurnText
              .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
              .trim();
            if (cleanTurnText) {
              await adminSupabase.from("messages").insert({
                chat_id: currentChatId,
                sender_id: null,
                role: "assistant",
                content: cleanTurnText,
              });
            }
          }

          const toolCalls = finalMsg.content.filter(
            (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
          );
          if (toolCalls.length === 0) break;

          if (toolCalls.some((tc) => tc.name === "web_search")) {
            webSearchUsed = true;
            controller.enqueue(encoder.encode(SEARCH_STATUS_SENTINEL));
          }
          if (toolCalls.some((tc) => tc.name === "browse_url")) {
            browseUrlUsed = true;
            controller.enqueue(encoder.encode(BROWSE_STATUS_SENTINEL));
          }
          if (toolCalls.some((tc) => DOCUMENT_TOOL_NAMES.has(tc.name))) {
            controller.enqueue(encoder.encode(DOCUMENT_STATUS_SENTINEL));
          }

          const toolResults = await Promise.all(
            toolCalls.map(async (tc) => {
              let result: string;
              try {
                if (tc.name === "web_search" || tc.name === "browse_url") {
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
                } else if (DOCUMENT_TOOL_NAMES.has(tc.name)) {
                  result = await executeDocumentTool(
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
              const isToolError = result.startsWith("Error:");
              return {
                type: "tool_result" as const,
                tool_use_id: tc.id,
                content: result,
                ...(isToolError ? { is_error: true } : {}),
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

        // Persist the final turn's text before close. Per-turn saves already wrote any
        // intermediate turns above; this captures only the last assistant turn.
        if (!isIncognito && currentChatId && currentTurnText.trim()) {
          const cleanResponse = currentTurnText
            .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
            .trim();
          if (cleanResponse) {
            const { error: insertErr } = await adminSupabase.from("messages").insert({
              chat_id: currentChatId,
              sender_id: null,
              role: "assistant",
              content: cleanResponse,
              ...(webSearchUsed || browseUrlUsed ? { metadata: { web_search_used: webSearchUsed, browse_url_used: browseUrlUsed } } : {}),
            });
            if (insertErr) {
              console.error("[api/chat] Failed to persist assistant message:", insertErr);
            } else {
              const { error: updateErr } = await adminSupabase
                .from("chats")
                .update({ last_message_at: new Date().toISOString() })
                .eq("id", currentChatId);
              if (updateErr) {
                console.error("[api/chat] Failed to update chat timestamp:", updateErr);
              }
            }
          }
        }

        controller.close();
      } catch (err) {
        console.error("[api/chat] Stream error:", {
          model: preferredModel,
          messageCount: anthropicMessages.length,
          error: err instanceof Error ? err.message : String(err),
        });
        // Best-effort: save the current turn's partial text before the error
        if (!isIncognito && currentChatId && currentTurnText.trim()) {
          const cleanResponse = currentTurnText
            .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
            .trim();
          if (cleanResponse) {
            const { error: insertErr } = await adminSupabase.from("messages").insert({
              chat_id: currentChatId,
              sender_id: null,
              role: "assistant",
              content: cleanResponse,
            });
            if (insertErr) {
              console.error("[api/chat] Failed to persist partial assistant message:", insertErr);
            }
          }
        }
        controller.error(err);
      }
    },
  });

  return new Response(readableStream, { headers: responseHeaders });
}
