import { describe, it, expect } from "vitest";
import {
  createWorkingLogRecorder,
  workingLogToDisplay,
  extractToolDetail,
  type WorkingLogEntry,
} from "@/lib/chat/workingLog";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import { formatAssistantReplay, WORKING_LOG_MAX_ENTRIES, TOOL_TRACE_RESULT_CAP } from "@/lib/chat/toolTrace";

const clean = (s: string) => s.trim();

describe("createWorkingLogRecorder — block routing", () => {
  it("routes a no-tool turn entirely to the reply", () => {
    const rec = createWorkingLogRecorder(clean);
    rec.addText("Hello ");
    rec.addText("there.");
    const { reply, log, promoted } = rec.finish();
    expect(reply).toBe("Hello there.");
    expect(log).toEqual([]);
    expect(promoted).toBe(false);
  });

  it("routes pre-tool text to narration and post-tool text to the reply", () => {
    const rec = createWorkingLogRecorder(clean);
    rec.addText("Let me read the sheet…");
    expect(rec.breakSegment()).toBe(true);
    rec.addToolCall("read_spreadsheet", "Read spreadsheet", '{"row_count":42}', false);
    rec.addText("Done — 42 rows found.");
    const { reply, log, promoted } = rec.finish();
    expect(reply).toBe("Done — 42 rows found.");
    expect(promoted).toBe(false);
    expect(log).toEqual([
      { type: "narration", text: "Let me read the sheet…" },
      { type: "tool_use", tool: "read_spreadsheet", label: "Read spreadsheet" },
      { type: "tool_result", tool: "read_spreadsheet", result: '{"row_count":42}' },
    ]);
  });

  it("returns false from breakSegment when the segment is empty (no sentinel emitted)", () => {
    const rec = createWorkingLogRecorder(clean);
    expect(rec.breakSegment()).toBe(false);
    rec.addText("   ");
    expect(rec.breakSegment()).toBe(false);
  });

  it("promotes the last narration when the final turn produced no text", () => {
    const rec = createWorkingLogRecorder(clean);
    rec.addText("First note");
    rec.breakSegment();
    rec.addToolCall("send_email", "Send email", '{"success":true}', false);
    rec.addText("Sent it — all set.");
    rec.breakSegment(); // second tool follows the text
    rec.addToolCall("archive_email", "Archive email", '{"success":true}', false);
    const { reply, log, promoted } = rec.finish();
    expect(promoted).toBe(true);
    expect(reply).toBe("Sent it — all set.");
    // the promoted segment is removed from the log
    expect(log.filter((e) => e.type === "narration")).toEqual([
      { type: "narration", text: "First note" },
    ]);
  });

  it("marks tool errors with is_error", () => {
    const rec = createWorkingLogRecorder(clean);
    rec.addToolCall("read_csv", "Read CSV", "Error: not found", true);
    rec.addText("That file doesn't exist.");
    const { log } = rec.finish();
    expect(log[1]).toEqual({ type: "tool_result", tool: "read_csv", result: "Error: not found", is_error: true });
  });

  it("caps narration text and total entries", () => {
    const rec = createWorkingLogRecorder(clean);
    rec.addText("x".repeat(TOOL_TRACE_RESULT_CAP + 50));
    rec.breakSegment();
    for (let i = 0; i < WORKING_LOG_MAX_ENTRIES; i++) {
      rec.addToolCall(`tool_${i}`, `Tool ${i}`, "ok", false);
    }
    rec.addText("done");
    const { log } = rec.finish();
    expect(log.length).toBe(WORKING_LOG_MAX_ENTRIES);
    const narration = log.find((e) => e.type === "narration");
    // narration was capped (or dropped by the entry cap — both acceptable)
    if (narration && narration.type === "narration") {
      expect(narration.text.endsWith("… [truncated]")).toBe(true);
    }
  });
});

describe("workingLogToDisplay", () => {
  const log: WorkingLogEntry[] = [
    { type: "narration", text: "Reading the sheet" },
    { type: "tool_use", tool: "read_spreadsheet", label: "Read spreadsheet" },
    { type: "tool_result", tool: "read_spreadsheet", result: '{"file_name":"payroll.csv","row_count":42}' },
    { type: "tool_use", tool: "read_csv", label: "Read CSV" },
    { type: "tool_result", tool: "read_csv", result: "Error: boom", is_error: true },
  ];

  it("interleaves narration and tool lines chronologically", () => {
    const items = workingLogToDisplay(log);
    expect(items).toEqual([
      { kind: "narration", text: "Reading the sheet" },
      { kind: "tool", label: "Read spreadsheet", status: "done", detail: "payroll.csv (42 rows)" },
      { kind: "tool", label: "Read CSV", status: "error", detail: "Error: boom" },
    ]);
  });

  it("tolerates null/garbage input", () => {
    expect(workingLogToDisplay(null)).toEqual([]);
    expect(workingLogToDisplay(undefined)).toEqual([]);
    expect(workingLogToDisplay([{ bogus: true } as unknown as WorkingLogEntry])).toEqual([]);
  });
});

describe("extractToolDetail", () => {
  it("pulls file name with row count", () => {
    expect(extractToolDetail('{"file_name":"a.csv","row_count":3}')).toBe("a.csv (3 rows)");
  });
  it("returns undefined for non-JSON", () => {
    expect(extractToolDetail("plain text result")).toBeUndefined();
  });
});

describe("normalizeMessage — working_log reconstruction", () => {
  it("extracts metadata.working_log as a typed array", () => {
    const row = {
      id: "m1",
      role: "assistant",
      content: "Reply",
      created_at: "2026-06-10T00:00:00Z",
      sender_id: null,
      metadata: { working_log: [{ type: "narration", text: "note" }] },
    };
    const n = normalizeMessage(row);
    expect(n.working_log).toEqual([{ type: "narration", text: "note" }]);
    expect(workingLogToDisplay(n.working_log)).toEqual([{ kind: "narration", text: "note" }]);
  });

  it("returns null when absent or malformed", () => {
    expect(normalizeMessage({ id: "a", role: "user", content: "x", created_at: "t" }).working_log).toBeNull();
    expect(
      normalizeMessage({ id: "a", role: "user", content: "x", created_at: "t", metadata: { working_log: "bad" } }).working_log
    ).toBeNull();
  });
});

describe("formatAssistantReplay — working_log", () => {
  it("replays narration and tool results within the block", () => {
    const out = formatAssistantReplay("Final reply.", {
      working_log: [
        { type: "narration", text: "Checking the sheet" },
        { type: "tool_use", tool: "read_spreadsheet", label: "Read spreadsheet" },
        { type: "tool_result", tool: "read_spreadsheet", result: "42 rows" },
      ],
    });
    expect(out).toBe(
      "Final reply.\n\n[Working log from this turn:\n- (working note): Checking the sheet\n- read_spreadsheet: 42 rows]"
    );
  });

  it("flags errored tool results", () => {
    const out = formatAssistantReplay("", {
      working_log: [{ type: "tool_result", tool: "read_csv", result: "Error: boom", is_error: true }],
    });
    expect(out).toContain("- read_csv (error): Error: boom");
  });

  it("prefers working_log over legacy tool_trace when both exist", () => {
    const out = formatAssistantReplay("t", {
      working_log: [{ type: "tool_result", tool: "new_tool", result: "new" }],
      tool_trace: [{ tool: "old_tool", result: "old" }],
    });
    expect(out).toContain("new_tool");
    expect(out).not.toContain("old_tool");
  });

  it("still replays legacy tool_trace rows", () => {
    const out = formatAssistantReplay("t", {
      tool_trace: [{ tool: "web_search", result: "72°F" }],
    });
    expect(out).toContain("[Tool results from this turn:\n- web_search: 72°F]");
  });
});
