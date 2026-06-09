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
  WEB_SEARCH_TOOL,
  SEARCH_SYSTEM_BLOCK,
  SEARCH_STATUS_SENTINEL,
  BROWSE_TOOL,
  BROWSE_SYSTEM_BLOCK,
  BROWSE_STATUS_SENTINEL,
  HISTORY_SEARCH_TOOL,
  HISTORY_SEARCH_SYSTEM_BLOCK,
  HISTORY_SEARCH_STATUS_SENTINEL,
  executeSearchTool,
  executeHistorySearchTool,
} from "@/lib/searchTools";
import {
  DOCUMENT_TOOLS,
  DOCUMENT_TOOL_NAMES,
  DOCUMENT_SYSTEM_BLOCK,
  DOCUMENT_STATUS_SENTINEL,
  executeDocumentTool,
} from "@/lib/documents/documentTools";
import { IMAGE_VISION_BLOCK, IMAGE_SYSTEM_BLOCK, TASK_PROGRESS_SYSTEM_BLOCK } from "@/lib/anthropic";
import { type ImageQuality, editImageAndSave } from "@/lib/images/generate";
import {
  REMINDERS_TOOLS,
  REMINDERS_SYSTEM_BLOCK,
  executeRemindersTool,
} from "@/lib/remindersTools";
import {
  REACTION_TOOL,
  REACTION_SYSTEM_BLOCK,
  executeReactionTool,
} from "@/lib/chat/reactionTools";
import { BROWSE_PAGE_TOOL, BROWSER_SYSTEM_BLOCK } from "@/lib/browser/browseTool";

// ── Tool sets ────────────────────────────────────────────────────────────────
// Standalone + project chats get the full tool set including image generation.
// Family/group chats omit IMAGE_SYSTEM_BLOCK (no image generation) but still
// include vision (analyze incoming images) and all other tools.

export const EDIT_IMAGE_TOOL = {
  name: "edit_image",
  description:
    "Edit or transform an existing image based on a text instruction. Use when the user has attached an image and wants it modified — style transfer, background removal, color changes, object addition/removal, artistic transformation, etc. Do not use for generating new images from scratch.",
  input_schema: {
    type: "object" as const,
    properties: {
      image_url: {
        type: "string",
        description: "The public URL of the image to edit (from the [image_url: ...] tag in the message — never a blob URL)",
      },
      prompt: {
        type: "string",
        description: "Plain English instruction describing the edit",
      },
    },
    required: ["image_url", "prompt"],
  },
};

export const TOOLS_FULL = [
  ...CALENDAR_TOOLS,
  ...GMAIL_TOOLS,
  ...REMINDERS_TOOLS,
  WEB_SEARCH_TOOL, // Anthropic native server tool — added to every request
  BROWSE_TOOL,
  HISTORY_SEARCH_TOOL,
  ...DOCUMENT_TOOLS,
  REACTION_TOOL,
  EDIT_IMAGE_TOOL,
  BROWSE_PAGE_TOOL,
];

export function buildToolSystemBlocks(opts: { includeImageGen: boolean }): string {
  return (
    CALENDAR_SYSTEM_BLOCK +
    GMAIL_SYSTEM_BLOCK +
    REMINDERS_SYSTEM_BLOCK +
    (opts.includeImageGen ? IMAGE_SYSTEM_BLOCK : "") +
    IMAGE_VISION_BLOCK +
    SEARCH_SYSTEM_BLOCK +
    BROWSE_SYSTEM_BLOCK +
    HISTORY_SEARCH_SYSTEM_BLOCK +
    DOCUMENT_SYSTEM_BLOCK +
    TASK_PROGRESS_SYSTEM_BLOCK +
    REACTION_SYSTEM_BLOCK +
    BROWSER_SYSTEM_BLOCK
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
  /** ID of the user message Bruce is responding to — passed to react_to_message. Null for incognito. */
  latestUserMessageId?: string | null;
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
  /** Project id for scoping search_chat_history tool. Null for standalone/family. */
  searchContext?: { projectId: string | null };
  /** Called after the assistant message is persisted, before the stream closes. */
  onComplete?: (responseText: string) => Promise<void>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const IMAGE_TAG_RE = /<image_request>([\s\S]*?)<\/image_request>/;
const TOOL_TIMEOUT_MS = 90_000;

// Sentinel emitted after each tool call completes so the client can tick the
// task card live without waiting for Bruce's final text response.
// Format: \x1eTASK_PROGRESS:{"step":"...","status":"done"|"error","detail":"..."}\x1e
// Uses \x1e (same family as STATUS sentinels) — never \x1f, which is reserved for IMAGE_REQ.
export const TASK_PROGRESS_SENTINEL = "\x1eTASK_PROGRESS:";

// Emitted when Bruce's browse_page tool opens or moves the shared browser.
// Format: \x1eBROWSER_EVENT:{"sessionId":"...","liveViewUrl":"...","currentUrl":"...","isNew":true}\x1e
// Same \x1e family as STATUS/TASK_PROGRESS — the client strips it from display
// text and opens/updates the BrowserPanel from the latest one.
export const BROWSER_EVENT_SENTINEL = "\x1eBROWSER_EVENT:";

const TOOL_STEP_LABELS: Record<string, string> = {
  list_drive_files: "List Drive files",
  resolve_drive_path: "Resolve Drive path",
  read_spreadsheet: "Read spreadsheet",
  read_csv: "Read CSV",
  read_document: "Read document",
  create_spreadsheet: "Create spreadsheet",
  add_spreadsheet_tab: "Write spreadsheet tab",
  update_spreadsheet_cells: "Update cells",
  format_spreadsheet_tab: "Format tab",
  generate_csv: "Generate CSV",
  create_document: "Create document",
  update_document: "Update document",
  append_document: "Append to document",
  export_as_pdf: "Export PDF",
  web_search: "Search the web",
  browse_url: "Fetch URL",
  search_chat_history: "Search history",
  create_event: "Create calendar event",
  update_event: "Update calendar event",
  delete_event: "Delete calendar event",
  list_events: "List calendar events",
  get_event: "Get calendar event",
  respond_to_event: "Respond to event",
  suggest_time: "Find meeting time",
  send_email: "Send email",
  read_email: "Read email",
  list_emails: "List emails",
  archive_email: "Archive email",
  delete_email: "Delete email",
  manage_reminders: "Manage reminders",
  edit_image: "Edit image",
  browse_page: "Browse page",
};

// browse_page is executed specially (it needs the stream controller to emit the
// browser_event). Returns the tool-result text plus the panel event to emit.
async function executeBrowsePage(
  input: Record<string, unknown>,
  userId: string,
  chatId: string | null,
): Promise<{
  result: string;
  event: { sessionId: string; liveViewUrl: string; currentUrl: string; isNew: boolean } | null;
}> {
  if (!chatId) {
    return { result: "Error: the shared browser is not available in incognito chats.", event: null };
  }
  const action = typeof input.action === "string" ? input.action : "";
  if (!["navigate", "act", "extract", "screenshot"].includes(action)) {
    return { result: `Error: unknown browse_page action "${action}".`, event: null };
  }
  const url = typeof input.url === "string" ? input.url : undefined;
  const instruction = typeof input.instruction === "string" ? input.instruction : undefined;

  try {
    const { getActiveBrowserSession, createBrowserSession, updateSessionUrl } = await import(
      "@/lib/browser/browserbase"
    );
    const { performBrowserAction } = await import("@/lib/browser/stagehand");

    // Reuse the chat's single active session, or open one (panel opens via isNew).
    let session = await getActiveBrowserSession(chatId);
    let isNew = false;
    if (!session) {
      const created = await createBrowserSession(chatId, userId);
      session = {
        sessionId: created.sessionId,
        liveViewUrl: created.liveViewUrl,
        currentUrl: "about:blank",
        connectUrl: created.connectUrl,
      };
      isNew = true;
    }

    const browserAction = action as "navigate" | "act" | "extract" | "screenshot";
    let actionResult;
    try {
      actionResult = await performBrowserAction(session.sessionId, session.connectUrl, browserAction, { url, instruction });
    } catch (err) {
      // The session was dead (CDP connect failed). Spin up a fresh one and retry
      // once — the panel re-opens on the new session via isNew. If the retry also
      // fails, let it propagate to the catch below and surface to Bruce normally.
      if (err instanceof Error && err.message === "SESSION_DEAD") {
        const created = await createBrowserSession(chatId, userId);
        session = {
          sessionId: created.sessionId,
          liveViewUrl: created.liveViewUrl,
          currentUrl: "about:blank",
          connectUrl: created.connectUrl,
        };
        isNew = true;
        actionResult = await performBrowserAction(session.sessionId, session.connectUrl, browserAction, { url, instruction });
      } else {
        throw err;
      }
    }

    const currentUrl =
      actionResult.currentUrl && actionResult.currentUrl !== "about:blank"
        ? actionResult.currentUrl
        : session.currentUrl;
    if (actionResult.currentUrl && actionResult.currentUrl !== "about:blank") {
      await updateSessionUrl(chatId, actionResult.currentUrl);
    }

    const event = {
      sessionId: session.sessionId,
      liveViewUrl: session.liveViewUrl,
      currentUrl,
      isNew,
    };

    let result: string;
    if (actionResult.success) {
      // Screenshots return a data URL — don't dump it back into the model context.
      const payload = action === "screenshot" ? "(screenshot captured in the panel)" : actionResult.result;
      result = JSON.stringify({ success: true, currentUrl, result: payload });
    } else {
      result = `Error: ${actionResult.error ?? "browser action failed"} (current URL: ${currentUrl})`;
    }
    return { result, event };
  } catch (error) {
    console.error("BROWSE_PAGE_ERROR:", error);
    const message = error instanceof Error ? error.message : String(error);
    // Surface the real error to Bruce so it shows up in the chat instead of a
    // generic failure he can't explain.
    if (message === "SESSION_DEAD") {
      return { result: "Error: the shared browser session ended and could not be re-established. Ask the user to reopen the browser and try again.", event: null };
    }
    return { result: `Error: the shared browser failed — ${message}`, event: null };
  }
}

function extractStepDetail(toolName: string, result: string): string | undefined {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (typeof parsed.tab_name === "string") return `Tab ${parsed.tab_name}`;
    if (typeof parsed.title === "string") return parsed.title;
    if (typeof parsed.file_name === "string") {
      const rows = typeof parsed.row_count === "number" ? ` (${parsed.row_count} rows)` : "";
      return `${parsed.file_name}${rows}`;
    }
    if (Array.isArray(parsed.files)) return `${(parsed.files as unknown[]).length} files`;
    if (typeof parsed.row_count === "number") return `${parsed.row_count} rows`;
  } catch { /* ignore */ }
  if (toolName === "web_search" || toolName === "browse_url") return undefined;
  return undefined;
}

// ── Tool dispatch ────────────────────────────────────────────────────────────

async function executeOneTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  chatId: string | null,
  latestUserMessageId: string | null | undefined,
  projectId?: string | null,
): Promise<string> {
  if (name === "edit_image") {
    const imageUrl = typeof input.image_url === "string" ? input.image_url : "";
    const prompt = typeof input.prompt === "string" ? input.prompt : "";
    if (!imageUrl || imageUrl.startsWith("blob:")) {
      console.warn("[edit_image] Blob or missing URL — declining");
      return JSON.stringify({ error: "edit_image requires a public image URL — blob URLs cannot be edited remotely" });
    }
    if (!chatId) {
      // Incognito or no chat context — edit but skip DB save
      const { editImage } = await import("@/lib/image/editImage");
      const { url } = await editImage(imageUrl, prompt);
      return JSON.stringify({ url });
    }
    const { url } = await editImageAndSave(imageUrl, prompt, userId, chatId);
    return JSON.stringify({ url, saved: true });
  }
  if (name === "browse_url") {
    return executeSearchTool(name, input);
  }
  if (name === "search_chat_history") {
    return executeHistorySearchTool(input, userId, chatId, projectId ?? null);
  }
  if (name === "manage_reminders") {
    return executeRemindersTool(input, userId, chatId);
  }
  if (name === "react_to_message") {
    const emoji = typeof input.emoji === "string" ? input.emoji : "👍";
    return executeReactionTool(latestUserMessageId ?? null, chatId, emoji);
  }
  if (GMAIL_TOOL_NAMES.has(name)) {
    return executeGmailTool(name, input, userId);
  }
  if (DOCUMENT_TOOL_NAMES.has(name)) {
    return executeDocumentTool(name, input, userId);
  }
  return executeCalendarTool(name, input, userId);
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
  const { anthropic, model, maxTokens, systemPrompt, initialMessages, tools, userId, handleImageRequest, persist, searchContext, onComplete } = opts;

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

      // ── Streaming status lifecycle ("Thinking…" → "Searching the web…" → clear) ─
      // STATUS sentinels are \x1eSTATUS:text\x1e; the client shows the latest and
      // an empty payload clears it. statusShown tracks whether a label is visible
      // so the first text token can clear it.
      let statusShown = false;
      let firstTextSeen = false;
      let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
      function emitStatus(text: string) {
        controller.enqueue(encoder.encode(`\x1eSTATUS:${text}\x1e`));
        statusShown = text.length > 0;
      }
      function clearStatusIfShown() {
        if (statusShown) emitStatus("");
      }
      function clearThinkingTimer() {
        if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
      }

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
        // Tracks how many times we've pushed a "Continue." message to recover from
        // a max_tokens truncation that left no complete tool call in the turn.
        let maxTokensContinues = 0;
        const MAX_TOKENS_CONTINUES = 3;

        while (true) {
          const stream = anthropic.messages.stream({
            model,
            max_tokens: maxTokens ?? 2048,
            system: systemPrompt,
            messages: currentMessages,
            tools,
          }, { signal: clientAbort.signal });

          // Arm "Thinking…": if nothing has streamed 1.5s into the response, show
          // it so the typing dots don't feel frozen during the model's pre-search
          // processing window. firstTextSeen is response-wide, so this only fires
          // before the very first text token of the whole reply (no mid-reply flashes).
          thinkingTimer = setTimeout(() => {
            if (clientAbort.signal.aborted) return;
            if (!firstTextSeen && !statusShown) emitStatus("Thinking…");
          }, 1500);

          stream.on("text", (text) => {
            if (!firstTextSeen) { firstTextSeen = true; clearThinkingTimer(); }
            clearStatusIfShown(); // first real text clears Thinking…/Searching…
            fullResponse += text;
            handleText(text);
          });

          // Native web search runs server-side as a `server_tool_use` block — it
          // never appears as a client tool_use. Detect it from the raw stream so
          // we can switch the status to "Searching the web…" while Anthropic searches.
          stream.on("streamEvent", (event) => {
            const e = event as { type?: string; content_block?: { type?: string; name?: string } };
            if (
              e.type === "content_block_start" &&
              e.content_block?.type === "server_tool_use" &&
              e.content_block?.name === "web_search"
            ) {
              clearThinkingTimer();
              webSearchUsed = true;
              controller.enqueue(encoder.encode(SEARCH_STATUS_SENTINEL));
              statusShown = true;
            }
          });

          const finalMsg = await stream.finalMessage();
          clearThinkingTimer();

          // Extract tool calls first — a max_tokens truncation can still contain
          // a complete tool_use block if the tool call finished before the limit.
          // Gating the loop on toolCalls.length (not stop_reason) ensures those
          // tool calls are executed even when stop_reason is not "tool_use".
          const toolCalls = finalMsg.content.filter(
            (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
          );

          if (toolCalls.length === 0) {
            if (finalMsg.stop_reason === "max_tokens" && maxTokensContinues < MAX_TOKENS_CONTINUES) {
              // Model was cut off mid-response with no complete tool call.
              // Push a continuation and let it finish its thought / remaining tool calls.
              maxTokensContinues++;
              currentMessages = [
                ...currentMessages,
                { role: "assistant" as const, content: finalMsg.content },
                { role: "user" as const, content: "Continue." },
              ];
              continue;
            }
            // Text already streamed per-chunk via stream.on("text") → handleText(text).
            break;
          }

          // Has tool calls — reset the continuation counter and execute them.
          // No per-turn DB write here: writing intermediate rows caused the
          // assistant bubble to fragment after loadMessages() — a single
          // 'text → tool → text' sequence would become two stored rows but
          // one optimistic bubble, producing a flicker on reload. The full
          // response is persisted once after the loop. Connection death is
          // still safe — the catch handler below saves fullResponse.
          maxTokensContinues = 0;

          if (toolCalls.some((tc) => tc.name === "browse_url")) {
            browseUrlUsed = true;
            controller.enqueue(encoder.encode(BROWSE_STATUS_SENTINEL));
            statusShown = true;
          }
          if (toolCalls.some((tc) => tc.name === "search_chat_history")) {
            controller.enqueue(encoder.encode(HISTORY_SEARCH_STATUS_SENTINEL));
            statusShown = true;
          }
          if (toolCalls.some((tc) => DOCUMENT_TOOL_NAMES.has(tc.name))) {
            controller.enqueue(encoder.encode(DOCUMENT_STATUS_SENTINEL));
            statusShown = true;
          }

          const toolResults = await Promise.all(
            toolCalls.map(async (tc) => {
              let result: string;
              try {
                if (tc.name === "browse_page") {
                  // Special-cased: needs the controller to emit the browser_event
                  // sentinel so the panel opens the instant Bruce starts working.
                  const { result: r, event } = await Promise.race([
                    executeBrowsePage(tc.input as Record<string, unknown>, userId, persist.chatId),
                    new Promise<never>((_, reject) =>
                      setTimeout(
                        () => reject(new Error(`"${tc.name}" did not complete within ${TOOL_TIMEOUT_MS / 1000}s`)),
                        TOOL_TIMEOUT_MS
                      )
                    ),
                  ]);
                  if (event) {
                    controller.enqueue(encoder.encode(`${BROWSER_EVENT_SENTINEL}${JSON.stringify(event)}\x1e`));
                  }
                  result = r;
                } else {
                  result = await Promise.race([
                    executeOneTool(tc.name, tc.input as Record<string, unknown>, userId, persist.chatId, persist.latestUserMessageId, searchContext?.projectId),
                    new Promise<never>((_, reject) =>
                      setTimeout(
                        () => reject(new Error(`"${tc.name}" did not complete within ${TOOL_TIMEOUT_MS / 1000}s`)),
                        TOOL_TIMEOUT_MS
                      )
                    ),
                  ]);
                }
              } catch (err) {
                result = `Error: ${err instanceof Error ? err.message : String(err)}`;
              }
              const isToolError = result.startsWith("Error:");

              // react_to_message is a silent action — no task-progress card.
              if (tc.name !== "react_to_message") {
                const stepLabel = TOOL_STEP_LABELS[tc.name] ?? tc.name;
                const detail = isToolError
                  ? result.slice(0, 100)
                  : extractStepDetail(tc.name, result);
                const sentinelPayload = JSON.stringify({
                  step: stepLabel,
                  status: isToolError ? "error" : "done",
                  ...(detail ? { detail } : {}),
                });
                controller.enqueue(encoder.encode(`${TASK_PROGRESS_SENTINEL}${sentinelPayload}\x1e`));
              }

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
          if (onComplete && finalClean) await onComplete(finalClean).catch(() => {});
        }

        controller.close();
      } catch (err) {
        clearThinkingTimer(); // never let a pending timer enqueue onto a closed controller
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
