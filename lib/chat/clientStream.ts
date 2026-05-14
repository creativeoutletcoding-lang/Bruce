"use client";

import {
  extractLatestTaskProgress,
  stripTaskProgressTags,
} from "@/lib/chat/taskProgress";
import type { TaskProgressData } from "@/lib/chat/taskProgress";

// 24ms ≈ 42 fps — fluid enough that streamed text reads as continuous flow
// without flooding React's reconciler. Lower than the original 40ms (25 fps)
// to feel smoother across all three chat contexts.
export const STREAM_FLUSH_INTERVAL_MS = 24;

const STATUS_RE = /\x1eSTATUS:[^\x1e]*\x1e/g;

export interface StreamTick {
  display: string;
  task: TaskProgressData | null;
  workingStatus: string | null;
}

// Parse the accumulated bytes so far, returning the user-visible text, any
// task-progress data, and the latest STATUS sentinel. The IMAGE_REQ sentinel
// (separator \x1f) is treated as a stream terminator — everything before it
// is display text; the suffix is parsed by the caller after the read loop.
export function parseStreamFrame(accumulated: string): StreamTick {
  const sentinelIdx = accumulated.indexOf("\x1f");
  const raw = sentinelIdx !== -1 ? accumulated.slice(0, sentinelIdx) : accumulated;

  let workingStatus: string | null = null;
  const statusMatch = /\x1eSTATUS:([^\x1e]*)\x1e/.exec(raw);
  if (statusMatch) workingStatus = statusMatch[1];

  const task = extractLatestTaskProgress(raw);
  const display = stripTaskProgressTags(raw)
    .replace(STATUS_RE, "")
    .replace(/<image_request>[\s\S]*?<\/image_request>/g, "")
    .trimStart();

  return { display, task, workingStatus };
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
  flushIntervalMs = STREAM_FLUSH_INTERVAL_MS,
}: ConsumeStreamOptions): Promise<ConsumeStreamResult> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let pendingFlush = false;
  let aborted = false;

  const flush = () => {
    if (!pendingFlush) return;
    pendingFlush = false;
    onTick(parseStreamFrame(accumulated));
  };

  const timer = setInterval(flush, flushIntervalMs);

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
    }
  } catch (err) {
    if (!aborted) throw err;
  } finally {
    clearInterval(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
    // Final synchronous flush so the caller sees the last bytes.
    onTick(parseStreamFrame(accumulated));
  }

  return { accumulated, aborted };
}
