// Structural working-log routing — Claude.ai-style separation of Bruce's
// working process from his final reply.
//
// Server side: runChatStream routes assistant text by block position within
// the turn. Any text block followed by a tool_use in the same turn is working
// narration; the final text block is the reply. The routing is enforced on
// SDK stream block boundaries (content_block_start of tool_use), never by
// prompt compliance — a model that narrates anyway can only ever narrate into
// the working log, not the reply bubble or messages.content.
//
// Wire protocol: narration text streams on the default channel like reply
// text, but when a tool_use block starts the server emits NARRATION_BREAK —
// everything since the previous break belongs to the working log. If the
// final turn produced no reply text, PROMOTE_LAST tells the client to promote
// the last narration segment back to the reply so Bruce never says nothing.
//
// Persistence: messages.content holds the reply ONLY; the ordered narration +
// tool steps live in metadata.working_log (this module's WorkingLogEntry[]),
// with the same capping discipline as the old tool_trace.

import {
  truncateTraceResult,
  WORKING_LOG_MAX_ENTRIES,
} from "@/lib/chat/toolTrace";

// ── Sentinels (same \x1e family as STATUS / TASK_PROGRESS) ──────────────────

export const NARRATION_BREAK_SENTINEL = "\x1eNARRATION_BREAK\x1e";
export const PROMOTE_LAST_SENTINEL = "\x1ePROMOTE_LAST\x1e";

// ── Persisted shape (messages.metadata.working_log) ─────────────────────────

export type WorkingLogEntry =
  | { type: "narration"; text: string }
  | { type: "tool_use"; tool: string; label: string }
  | { type: "tool_result"; tool: string; result: string; is_error?: boolean };

// ── Display shape (live stream ticks + history reconstruction) ──────────────

export type WorkingLogDisplayItem =
  | { kind: "narration"; text: string }
  | { kind: "tool"; label: string; status: "done" | "error"; detail?: string };

// Pull a short human-readable detail out of a JSON tool result. Shared by the
// server (task-progress sentinel details) and the client (history rebuild).
export function extractToolDetail(result: string): string | undefined {
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
  } catch { /* not JSON — no detail */ }
  return undefined;
}

/**
 * Map persisted working_log entries to display items so a reloaded message
 * renders identically to the live stream. tool_result entries fold into the
 * preceding tool_use line (error status + detail) rather than rendering as
 * separate rows.
 */
export function workingLogToDisplay(
  entries: WorkingLogEntry[] | null | undefined
): WorkingLogDisplayItem[] {
  if (!Array.isArray(entries)) return [];
  const items: WorkingLogDisplayItem[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type === "narration" && typeof entry.text === "string" && entry.text.trim()) {
      items.push({ kind: "narration", text: entry.text });
    } else if (entry.type === "tool_use" && typeof entry.label === "string") {
      items.push({ kind: "tool", label: entry.label, status: "done" });
    } else if (entry.type === "tool_result" && typeof entry.result === "string") {
      // Fold into the most recent tool line for the same tool.
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === "tool") {
          if (entry.is_error) {
            item.status = "error";
            item.detail = entry.result.slice(0, 100);
          } else {
            const detail = extractToolDetail(entry.result);
            if (detail) item.detail = detail;
          }
          break;
        }
      }
    }
  }
  return items;
}

// ── Server-side recorder ─────────────────────────────────────────────────────
// Pure accumulator used by runChatStream. The stream handler feeds it text
// deltas and block-boundary events; it owns the narration/reply split and the
// persisted working_log. Cleaning (task XML / image tags) is injected so the
// recorder stays pure and unit-testable.

export interface WorkingLogRecorder {
  /** Append streamed text to the current segment. */
  addText(text: string): void;
  /**
   * A tool_use (or server_tool_use) block started, or the turn ended with tool
   * calls — everything in the current segment is narration. Returns true when
   * a NARRATION_BREAK sentinel must be emitted (segment had visible text).
   */
  breakSegment(): boolean;
  /** Record an executed tool call + its result, chronologically. */
  addToolCall(tool: string, label: string, result: string, isError: boolean): void;
  /**
   * Close the stream. The remaining segment is the reply; if it is empty and
   * narration exists, the last narration entry is promoted to the reply
   * (`promoted: true` — the caller emits PROMOTE_LAST when still streaming).
   */
  finish(): { reply: string; log: WorkingLogEntry[]; promoted: boolean };
}

export function createWorkingLogRecorder(
  clean: (raw: string) => string
): WorkingLogRecorder {
  const log: WorkingLogEntry[] = [];
  let segment = "";
  let lastNarrationFull = "";

  return {
    addText(text: string) {
      segment += text;
    },
    breakSegment(): boolean {
      const cleaned = clean(segment);
      segment = "";
      if (!cleaned) return false;
      log.push({ type: "narration", text: truncateTraceResult(cleaned) });
      lastNarrationFull = cleaned;
      return true;
    },
    addToolCall(tool: string, label: string, result: string, isError: boolean) {
      log.push({ type: "tool_use", tool, label });
      log.push({
        type: "tool_result",
        tool,
        result: truncateTraceResult(result),
        ...(isError ? { is_error: true } : {}),
      });
    },
    finish() {
      let reply = clean(segment);
      let promoted = false;
      if (!reply && lastNarrationFull) {
        for (let i = log.length - 1; i >= 0; i--) {
          if (log[i].type === "narration") {
            log.splice(i, 1);
            break;
          }
        }
        reply = lastNarrationFull;
        promoted = true;
      }
      return { reply, log: log.slice(-WORKING_LOG_MAX_ENTRIES), promoted };
    },
  };
}
