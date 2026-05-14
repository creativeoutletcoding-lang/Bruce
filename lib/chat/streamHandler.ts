import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractLatestTaskProgress,
  stripTaskProgressTags,
} from "@/lib/chat/taskProgress";
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
import { IMAGE_VISION_BLOCK, IMAGE_SYSTEM_BLOCK, TASK_PROGRESS_SYSTEM_BLOCK } from "@/lib/anthropic";
import { type ImageQuality } from "@/lib/images/generate";

// ── Tool sets ────────────────────────────────────────────────────────────────
// Standalone + project chats get the full tool set including image generation.
// Family/group chats omit IMAGE_SYSTEM_BLOCK (no image generation) but still
// include vision (analyze incoming images) and all other tools.

export const TOOLS_FULL = [
  ...CALENDAR_TOOLS,
  ...GMAIL_TOOLS,
  SEARCH_TOOL,
  BROWSE_TOOL,
  ...DOCUMENT_TOOLS,
];

export function buildToolSystemBlocks(opts: { includeImageGen: boolean }): string {
  return (
    CALENDAR_SYSTEM_BLOCK +
    GMAIL_SYSTEM_BLOCK +
    (opts.includeImageGen ? IMAGE_SYSTEM_BLOCK : "") +
    IMAGE_VISION_BLOCK +
    SEARCH_SYSTEM_BLOCK +
    BROWSE_SYSTEM_BLOCK +
    DOCUMENT_SYSTEM_BLOCK +
    TASK_PROGRESS_SYSTEM_BLOCK
  );
}

// ── Persistence shape ────────────────────────────────────────────────────────

export interface PersistOptions {
  /** Persist user/assistant rows. False for incognito or for routes that handle their own writes. */
  enabled: boolean;
  /** Service-role client used to bypass RLS for writes. */
  adminSupabase: SupabaseClient;
  /** Chat row id — must exist before stream starts. */
  chatId: string | null;
}

export interface StreamRunOptions {
  anthropic: Anthropic;
  model: string;
  maxTokens?: number;
  systemPrompt: string;
  initialMessages: Anthropic.Messages.MessageParam[];
  tools: typeof TOOLS_FULL;
  /** Anthropic user id, needed to scope tool execution to the right Google account. */
  userId: string;
  /** When true, intercept the <image_request> tag and emit IMAGE_REQ sentinel. */
  handleImageRequest: boolean;
  persist: PersistOptions;
}

// ── Constants ────────────────────────────────────────────────────────────────

const IMAGE_TAG_RE = /<image_request>([\s\S]*?)<\/image_request>/;
const TOOL_TIMEOUT_MS = 90_000;

// ── Tool dispatch ────────────────────────────────────────────────────────────

async function executeOneTool(
  name: string,
  input: Record<string, unknown>,
  userId: string
): Promise<string> {
  if (name === "web_search" || name === "browse_url") {
    return executeSearchTool(name, input);
  }
  if (GMAIL_TOOL_NAMES.has(name)) {
    return executeGmailTool(name, input, userId);
  }
  if (DOCUMENT_TOOL_NAMES.has(name)) {
    return executeDocumentTool(name, input, userId);
  }
  return executeCalendarTool(name, input);
}

// ── Stream runner ────────────────────────────────────────────────────────────
// Returns a ReadableStream the route can return directly. Caller is responsible
// for setting response headers (Content-Type, X-Chat-Id, etc.).
//
// Per-turn writes: when Bruce produces text in a turn that ends in a tool call,
// that text is saved before tool execution so partial output survives crashes.
// The final turn's text is written after the loop. The 'currentTurnText' is
// reset at the start of each turn so we never double-write.

export function runChatStream(opts: StreamRunOptions): ReadableStream<Uint8Array> {
  const { anthropic, model, maxTokens, systemPrompt, initialMessages, tools, userId, handleImageRequest, persist } = opts;

  // Aborted when the client disconnects (ReadableStream cancel callback below).
  const clientAbort = new AbortController();

  return new ReadableStream({
    cancel() {
      clientAbort.abort();
    },
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";
      let pendingTag = "";

      // The pendingTag buffer holds tail bytes that might be the start of an
      // <image_request> tag. We only buffer when image-gen is active; otherwise
      // everything is flushed immediately for smoothest streaming.

      function flushPending() {
        if (!pendingTag) return;
        const clean = pendingTag.replace(/<image_request>[\s\S]*?<\/image_request>/g, "");
        if (clean) controller.enqueue(encoder.encode(clean));
        pendingTag = "";
      }

      function handleText(text: string) {
        if (!handleImageRequest) {
          // Fast path — emit every chunk immediately, no boundary buffering.
          controller.enqueue(encoder.encode(text));
          return;
        }
        pendingTag += text;
        const tagStart = pendingTag.indexOf("<image_request>");
        if (tagStart !== -1) {
          if (tagStart > 0) controller.enqueue(encoder.encode(pendingTag.slice(0, tagStart)));
          pendingTag = pendingTag.slice(tagStart);
          const tagEnd = pendingTag.indexOf("</image_request>");
          if (tagEnd !== -1) {
            const after = pendingTag.slice(tagEnd + "</image_request>".length);
            pendingTag = "";
            if (after) controller.enqueue(encoder.encode(after));
          }
          return;
        }
        // No tag — flush all but a small safety window in case a tag is being formed.
        const safe = pendingTag.length > 15 ? pendingTag.length - 15 : 0;
        if (safe > 0) {
          controller.enqueue(encoder.encode(pendingTag.slice(0, safe)));
          pendingTag = pendingTag.slice(safe);
        }
      }

      async function persistAssistant(text: string, metadata: Record<string, unknown> | null) {
        if (!persist.enabled || !persist.chatId) return;
        const row: Record<string, unknown> = {
          chat_id: persist.chatId,
          sender_id: null,
          role: "assistant",
          content: text,
        };
        if (metadata && Object.keys(metadata).length > 0) row.metadata = metadata;
        const { error: insertErr } = await persist.adminSupabase.from("messages").insert(row);
        if (insertErr) {
          console.error("[streamHandler] Failed to persist assistant message:", insertErr);
          return;
        }
        const { error: updateErr } = await persist.adminSupabase
          .from("chats")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", persist.chatId);
        if (updateErr) {
          console.error("[streamHandler] Failed to update chat timestamp:", updateErr);
        }
      }

      function cleanText(raw: string): string {
        let s = stripTaskProgressTags(raw);
        if (handleImageRequest) s = s.replace(/<image_request>[\s\S]*?<\/image_request>/g, "");
        return s.trim();
      }

      try {
        let currentMessages = [...initialMessages];
        let webSearchUsed = false;
        let browseUrlUsed = false;

        while (true) {
          let turnText = "";

          const stream = anthropic.messages.stream({
            model,
            max_tokens: maxTokens ?? 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools,
          }, { signal: clientAbort.signal });

          stream.on("text", (text) => {
            turnText += text;
            fullResponse += text;
          });

          const finalMsg = await stream.finalMessage();

          if (finalMsg.stop_reason !== "tool_use") {
            handleText(turnText);
            break;
          }

          // No per-turn DB write here: writing intermediate rows caused the
          // assistant bubble to fragment after loadMessages() — a single
          // 'text → tool → text' sequence would become two stored rows but
          // one optimistic bubble, producing a flicker on reload. The full
          // response is persisted once after the loop. Connection death is
          // still safe — the catch handler below saves fullResponse.

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
                result = await Promise.race([
                  executeOneTool(tc.name, tc.input as Record<string, unknown>, userId),
                  new Promise<never>((_, reject) =>
                    setTimeout(
                      () => reject(new Error(`"${tc.name}" did not complete within ${TOOL_TIMEOUT_MS / 1000}s`)),
                      TOOL_TIMEOUT_MS
                    )
                  ),
                ]);
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

        flushPending();

        // Image request sentinel — client picks up and triggers /api/images/generate
        if (handleImageRequest && persist.chatId) {
          const imageMatch = IMAGE_TAG_RE.exec(fullResponse);
          if (imageMatch) {
            try {
              const tagContent = JSON.parse(imageMatch[1]) as { prompt: string; quality?: ImageQuality };
              controller.enqueue(
                encoder.encode(
                  `\x1fIMAGE_REQ:${JSON.stringify({
                    prompt: tagContent.prompt,
                    quality: tagContent.quality ?? "standard",
                    chatId: persist.chatId,
                  })}`
                )
              );
            } catch {
              /* malformed tag — ignore */
            }
          }
        }

        // Persist the entire conversation across all turns as one row. This
        // is what keeps the bubble continuous: the optimistic client message
        // built up over the stream maps 1:1 to the row written here.
        const taskData = extractLatestTaskProgress(fullResponse);
        const finalClean = cleanText(fullResponse);
        if (finalClean || taskData) {
          const metadata: Record<string, unknown> = {};
          if (webSearchUsed || browseUrlUsed) {
            metadata.web_search_used = webSearchUsed;
            metadata.browse_url_used = browseUrlUsed;
          }
          if (taskData) {
            metadata.content_type = "task";
            metadata.task_data = taskData;
          }
          await persistAssistant(finalClean, metadata);
        }

        controller.close();
      } catch (err) {
        if (clientAbort.signal.aborted) {
          // Client disconnected — persist whatever was generated and close cleanly.
          // Do NOT call controller.error() so the response closes without a noisy error.
          const clean = cleanText(fullResponse);
          if (clean) await persistAssistant(clean, { interrupted: true }).catch(() => {});
          controller.close();
          return;
        }
        console.error("[streamHandler] Stream error:", err instanceof Error ? err.message : String(err));
        // Best-effort: save whatever the model produced up to the failure so
        // the user doesn't lose visible work.
        if (fullResponse.trim()) {
          const clean = cleanText(fullResponse);
          if (clean) await persistAssistant(clean, null);
        }
        controller.error(err);
      }
    },
  });
}

// ── History sanitization ─────────────────────────────────────────────────────
// Anthropic rejects non-alternating user/assistant messages. Failed previous
// turns can leave the DB with two user messages in a row; collapse those.

export function sanitizeAlternatingMessages(
  raw: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
  return raw
    .reduce<Anthropic.Messages.MessageParam[]>((acc, msg) => {
      if (acc.length > 0 && acc[acc.length - 1].role === msg.role) {
        acc[acc.length - 1] = msg;
      } else {
        acc.push(msg);
      }
      return acc;
    }, [])
    .filter((_, i, arr) => i !== 0 || arr[0].role === "user");
}
