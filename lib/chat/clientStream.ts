"use client";

import {
  extractLatestTaskProgress,
  stripTaskProgressTags,
} from "@/lib/chat/taskProgress";
import type { TaskProgressData, TaskStepStatus } from "@/lib/chat/taskProgress";
import type { WorkingLogDisplayItem } from "@/lib/chat/workingLog";

export type { WorkingLogDisplayItem };

// RAF ≈ 16ms at 60 fps — the primary flush mechanism, synchronized to the
// browser's paint cycle. The constant is kept as a fallback for non-browser
// environments (SSR edge cases).
export const STREAM_FLUSH_INTERVAL_MS = 16;

// 60ms pause inserted before rendering content that follows a paragraph break
// (double newline). Gives structural separation physical weight — paragraphs
// feel considered rather than continuous. Only applies mid-stream; the final
// render at stream end always flushes immediately.
export const PARAGRAPH_PAUSE_MS = 60;

// Single tokenizer over every \x1e-framed sentinel. One pass preserves the
// chronological interleave of narration segments and tool events for the
// working-log container. NARRATION_BREAK and PROMOTE_LAST carry no payload.
const SENTINEL_RE =
  /\x1e(?:STATUS:([^\x1e]*)|TASK_PROGRESS:([^\x1e]*)|BROWSER_EVENT:([^\x1e]*)|NARRATION_BREAK|PROMOTE_LAST)\x1e/g;

export interface BrowserEvent {
  sessionId: string;
  liveViewUrl: string;
  currentUrl: string;
  isNew: boolean;
}

export interface StreamTick {
  display: string;
  task: TaskProgressData | null;
  workingStatus: string | null;
  /** Latest shared-browser event (panel open/update), or null if none yet. */
  browserEvent: BrowserEvent | null;
  /** Chronological working-log items (narration + tool lines). Empty when the turn used no tools. */
  workingLog: WorkingLogDisplayItem[];
}

// Strip the in-text XML blocks (task progress incl. unclosed, image requests)
// from a text segment. Sentinels are handled by the tokenizer, not here.
function cleanSegment(raw: string): string {
  return stripTaskProgressTags(raw).replace(/<image_request>[\s\S]*?<\/image_request>/g, "");
}

// Parse the accumulated bytes so far, returning the user-visible reply text,
// the working log, any task-progress data, and the latest STATUS sentinel.
// Narration routing: text before each NARRATION_BREAK belongs to the working
// log; only the text after the last break is the reply. The IMAGE_REQ
// sentinel (separator \x1f) is treated as a stream terminator — everything
// before it is display text; the suffix is parsed by the caller after the
// read loop.
export function parseStreamFrame(accumulated: string): StreamTick {
  const sentinelIdx = accumulated.indexOf("\x1f");
  const raw = sentinelIdx !== -1 ? accumulated.slice(0, sentinelIdx) : accumulated;

  // The LAST status / browser event wins — only the most recent reflects the
  // current state. An empty STATUS payload ("") clears the indicator.
  let workingStatus: string | null = null;
  let browserEvent: BrowserEvent | null = null;
  let promote = false;
  const workingLog: WorkingLogDisplayItem[] = [];

  // Task card accumulation — each TASK_PROGRESS sentinel carries one step
  // completion event, deduped by step label so the card ticks live. The
  // working log keeps every event as its own chronological line instead.
  const stepOrder: string[] = [];
  const stepMap = new Map<string, { status: TaskStepStatus; detail?: string }>();

  let currentText = "";
  let cursor = 0;
  SENTINEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTINEL_RE.exec(raw)) !== null) {
    currentText += raw.slice(cursor, m.index);
    cursor = m.index + m[0].length;
    if (m[0] === "\x1eNARRATION_BREAK\x1e") {
      const text = cleanSegment(currentText).trim();
      if (text) workingLog.push({ kind: "narration", text });
      currentText = "";
    } else if (m[0] === "\x1ePROMOTE_LAST\x1e") {
      promote = true;
    } else if (m[1] !== undefined) {
      workingStatus = m[1];
    } else if (m[2] !== undefined) {
      try {
        const ev = JSON.parse(m[2]) as { step: string; status: string; detail?: string };
        if (!stepMap.has(ev.step)) stepOrder.push(ev.step);
        stepMap.set(ev.step, { status: ev.status as TaskStepStatus, detail: ev.detail });
        workingLog.push({
          kind: "tool",
          label: ev.step,
          status: ev.status === "error" ? "error" : "done",
          ...(ev.detail ? { detail: ev.detail } : {}),
        });
      } catch { /* skip malformed */ }
    } else if (m[3] !== undefined) {
      try {
        browserEvent = JSON.parse(m[3]) as BrowserEvent;
      } catch { /* skip malformed */ }
    }
  }
  // Tail after the last sentinel. A lone \x1e here is a sentinel split across
  // network chunks — hide it (and anything after) until its terminator arrives.
  let tail = raw.slice(cursor);
  const loneIdx = tail.indexOf("\x1e");
  if (loneIdx !== -1) tail = tail.slice(0, loneIdx);
  currentText += tail;

  let sentinelTask: TaskProgressData | null = null;
  if (stepOrder.length > 0) {
    sentinelTask = {
      task: "",
      steps: stepOrder.map((label) => {
        const s = stepMap.get(label)!;
        return { id: label, label, status: s.status, ...(s.detail ? { detail: s.detail } : {}) };
      }),
    };
  }

  // XML-based extraction for the final turn (Bruce's summary text may include
  // a <task_progress> block with the full task name and resolved step list).
  // Prefer XML when available; fall back to sentinel-built state.
  const task = extractLatestTaskProgress(raw) ?? sentinelTask;

  let display = cleanSegment(currentText).trimStart();

  // The server promoted the last narration segment to the reply (the final
  // turn produced no text after its tools). Mirror it: pop the segment from
  // the working log and surface it as the reply.
  if (promote && !display.trim()) {
    for (let i = workingLog.length - 1; i >= 0; i--) {
      const item = workingLog[i];
      if (item.kind === "narration") {
        display = item.text;
        workingLog.splice(i, 1);
        break;
      }
    }
  }

  return { display, task, workingStatus, browserEvent, workingLog };
}

export interface FinalizedStream {
  display: string;
  task: TaskProgressData | null;
  workingLog: WorkingLogDisplayItem[];
}

// Compute the final user-visible text, working log, and task-progress data
// once the stream has fully accumulated. Reuses parseStreamFrame's canonical
// routing/stripping so every chat context finalizes identically. The only
// difference from a live tick is a full trim() rather than trimStart().
export function finalizeStream(accumulated: string): FinalizedStream {
  const { display, task, workingLog } = parseStreamFrame(accumulated);
  return { display: display.trim(), task, workingLog };
}

export interface ImageReqPayload {
  prompt: string;
  quality: "standard" | "hd";
  chatId: string;
}

// Pull the IMAGE_REQ payload (if any) from the accumulated stream.
export function extractImageRequest(accumulated: string): ImageReqPayload | null {
  const parts = accumulated.split("\x1f");
  const sentinel = parts.find((p) => p.startsWith("IMAGE_REQ:"));
  if (!sentinel) return null;
  try {
    return JSON.parse(sentinel.slice("IMAGE_REQ:".length)) as ImageReqPayload;
  } catch {
    return null;
  }
}

// Resolve any task steps still in "working" — stream ended before Claude could
// finalize them, so mark them as error rather than leaving them spinning.
export function resolveAbandonedTaskSteps(
  data: TaskProgressData,
  reason: "interrupted" | "incomplete" = "incomplete"
): TaskProgressData {
  const errorMsg = reason === "interrupted" ? "Cancelled" : "Did not complete — try again";
  return {
    ...data,
    steps: data.steps.map((s) =>
      s.status === "working" || s.status === "pending"
        ? { ...s, status: reason === "interrupted" ? ("cancelled" as const) : ("error" as const), error: reason === "interrupted" ? undefined : errorMsg }
        : s
    ),
  };
}

// ── Shared stream consumer ───────────────────────────────────────────────────
// Reads the response body, fires onTick on a fixed flush interval, and returns
// the final accumulated string. Centralizes the duplicated reader/flush-loop
// across all three chat contexts so smooth-streaming fixes apply everywhere.

export interface ConsumeStreamOptions {
  response: Response;
  signal?: AbortSignal;
  onTick: (tick: StreamTick) => void;
  flushIntervalMs?: number;
}

export interface ConsumeStreamResult {
  accumulated: string;
  /** True when the consumer exited because the AbortSignal fired. */
  aborted: boolean;
}

export async function consumeStream({
  response,
  signal,
  onTick,
}: ConsumeStreamOptions): Promise<ConsumeStreamResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let lastRenderedLength = 0;
  let pendingFlush = false;
  let aborted = false;

  // RAF handle for the 1-frame render buffer; null when no frame is queued.
  let rafHandle: number | null = null;
  // Timeout handle for the 60ms paragraph-breathing pause; null when no pause is pending.
  let pauseHandle: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (!pendingFlush) return;
    pendingFlush = false;
    lastRenderedLength = accumulated.length;
    onTick(parseStreamFrame(accumulated));
  };

  // Schedule a flush at the next animation frame, or after a 60ms paragraph
  // pause if new content crosses a double-newline boundary.
  //
  // Rules:
  // - Paragraph break detected → cancel any pending RAF, (re)set the 60ms pause
  // - No paragraph break and nothing is scheduled → queue a RAF
  // - No paragraph break but a pause is already running → leave it alone
  const scheduleFlush = (hasParagraphBreak: boolean) => {
    if (hasParagraphBreak) {
      if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
      if (pauseHandle !== null) clearTimeout(pauseHandle);
      pauseHandle = setTimeout(() => {
        pauseHandle = null;
        rafHandle = requestAnimationFrame(() => { rafHandle = null; flush(); });
      }, PARAGRAPH_PAUSE_MS);
    } else if (pauseHandle === null && rafHandle === null) {
      rafHandle = requestAnimationFrame(() => { rafHandle = null; flush(); });
    }
  };

  const onAbort = () => {
    aborted = true;
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      pendingFlush = true;
      // 1-char lookback so a \n split across chunk boundaries is still caught.
      const windowStart = Math.max(0, lastRenderedLength - 1);
      scheduleFlush(accumulated.slice(windowStart).includes("\n\n"));
    }
  } catch (err) {
    if (!aborted) throw err;
  } finally {
    // Cancel any in-flight scheduled flush — the final render below is immediate.
    if (rafHandle !== null) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    if (pauseHandle !== null) { clearTimeout(pauseHandle); pauseHandle = null; }
    if (signal) signal.removeEventListener("abort", onAbort);
    // Final synchronous flush so the caller sees the last bytes.
    onTick(parseStreamFrame(accumulated));
  }

  return { accumulated, aborted };
}
