// Compact record of the tool calls Bruce made in a turn, persisted in
// messages.metadata.tool_trace and replayed into history so follow-up turns
// keep the grounding (web results, document data, browse summaries) instead
// of forcing re-calls or hallucinated recall.

export interface ToolTraceEntry {
  tool: string;
  result: string;
}

/** Max chars stored per tool result. */
export const TOOL_TRACE_RESULT_CAP = 600;
/** Max trace entries persisted per assistant message. */
export const TOOL_TRACE_MAX_ENTRIES = 8;

export function truncateTraceResult(result: string): string {
  return result.length > TOOL_TRACE_RESULT_CAP
    ? result.slice(0, TOOL_TRACE_RESULT_CAP) + "… [truncated]"
    : result;
}

/**
 * Build the replay content for a persisted assistant message: the visible text
 * plus a compact tool-results block when a trace exists. Used by the chat
 * routes' history mappers — never persisted back to the DB.
 */
export function formatAssistantReplay(
  text: string,
  metadata: Record<string, unknown> | null | undefined
): string {
  const trace = metadata?.tool_trace as ToolTraceEntry[] | undefined;
  if (!Array.isArray(trace) || trace.length === 0) return text;
  const lines = trace
    .filter((t) => t && typeof t.tool === "string" && typeof t.result === "string")
    .map((t) => `- ${t.tool}: ${t.result}`);
  if (lines.length === 0) return text;
  const block = `[Tool results from this turn:\n${lines.join("\n")}]`;
  return text.trim() ? `${text}\n\n${block}` : block;
}
