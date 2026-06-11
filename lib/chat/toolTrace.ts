// Compact record of the work Bruce did in a turn, persisted in
// messages.metadata and replayed into history so follow-up turns keep the
// grounding (web results, document data, browse summaries) instead of forcing
// re-calls or hallucinated recall.
//
// New rows persist metadata.working_log (ordered narration + tool_use +
// tool_result entries — see lib/chat/workingLog.ts). Older rows carry the
// legacy metadata.tool_trace shape; formatAssistantReplay reads both.

export interface ToolTraceEntry {
  tool: string;
  result: string;
}

/** Max chars stored per tool result or narration entry. */
export const TOOL_TRACE_RESULT_CAP = 600;
/** Max trace entries persisted per assistant message (legacy tool_trace). */
export const TOOL_TRACE_MAX_ENTRIES = 8;
/** Max working_log entries persisted per assistant message. Narration +
 * tool_use + tool_result triples per step, so this is a higher ceiling than
 * the legacy trace cap. */
export const WORKING_LOG_MAX_ENTRIES = 24;

export function truncateTraceResult(result: string): string {
  return result.length > TOOL_TRACE_RESULT_CAP
    ? result.slice(0, TOOL_TRACE_RESULT_CAP) + "… [truncated]"
    : result;
}

// Minimal structural view of a working_log entry — avoids a circular import
// with workingLog.ts (which imports the caps above).
interface ReplayLogEntry {
  type?: string;
  text?: string;
  tool?: string;
  result?: string;
  is_error?: boolean;
}

/**
 * Build the replay content for a persisted assistant message: the visible
 * reply text plus a compact working-log block when one exists. Prefers
 * metadata.working_log (narration + tool results, chronological); falls back
 * to the legacy metadata.tool_trace. Used by the chat routes' history
 * mappers — never persisted back to the DB.
 */
export function formatAssistantReplay(
  text: string,
  metadata: Record<string, unknown> | null | undefined
): string {
  const workingLog = metadata?.working_log as ReplayLogEntry[] | undefined;
  if (Array.isArray(workingLog) && workingLog.length > 0) {
    const lines: string[] = [];
    for (const entry of workingLog) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.type === "narration" && typeof entry.text === "string" && entry.text.trim()) {
        lines.push(`- (working note): ${truncateTraceResult(entry.text)}`);
      } else if (entry.type === "tool_result" && typeof entry.tool === "string" && typeof entry.result === "string") {
        const flag = entry.is_error ? " (error)" : "";
        lines.push(`- ${entry.tool}${flag}: ${truncateTraceResult(entry.result)}`);
      }
      // tool_use entries carry no replay value beyond their tool_result.
    }
    if (lines.length > 0) {
      const block = `[Working log from this turn:\n${lines.join("\n")}]`;
      return text.trim() ? `${text}\n\n${block}` : block;
    }
    return text;
  }

  const trace = metadata?.tool_trace as ToolTraceEntry[] | undefined;
  if (!Array.isArray(trace) || trace.length === 0) return text;
  const lines = trace
    .filter((t) => t && typeof t.tool === "string" && typeof t.result === "string")
    .map((t) => `- ${t.tool}: ${t.result}`);
  if (lines.length === 0) return text;
  const block = `[Tool results from this turn:\n${lines.join("\n")}]`;
  return text.trim() ? `${text}\n\n${block}` : block;
}
