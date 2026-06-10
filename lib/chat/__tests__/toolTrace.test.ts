import { describe, it, expect } from "vitest";
import {
  truncateTraceResult,
  formatAssistantReplay,
  TOOL_TRACE_RESULT_CAP,
} from "@/lib/chat/toolTrace";

describe("truncateTraceResult", () => {
  it("passes short results through", () => {
    expect(truncateTraceResult("short")).toBe("short");
  });

  it("caps long results", () => {
    const long = "x".repeat(TOOL_TRACE_RESULT_CAP + 100);
    const out = truncateTraceResult(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith("… [truncated]")).toBe(true);
  });
});

describe("formatAssistantReplay", () => {
  it("returns text unchanged when no trace exists", () => {
    expect(formatAssistantReplay("hello", null)).toBe("hello");
    expect(formatAssistantReplay("hello", {})).toBe("hello");
  });

  it("appends the tool-results block after the text", () => {
    const out = formatAssistantReplay("Here's the weather.", {
      tool_trace: [{ tool: "web_search", result: "72°F sunny" }],
    });
    expect(out).toBe("Here's the weather.\n\n[Tool results from this turn:\n- web_search: 72°F sunny]");
  });

  it("emits only the block when text is empty", () => {
    const out = formatAssistantReplay("", {
      tool_trace: [{ tool: "read_csv", result: "10 rows" }],
    });
    expect(out).toBe("[Tool results from this turn:\n- read_csv: 10 rows]");
  });

  it("skips malformed trace entries", () => {
    const out = formatAssistantReplay("text", {
      tool_trace: [{ tool: "ok_tool", result: "fine" }, { bogus: true }, null],
    });
    expect(out).toContain("ok_tool: fine");
    expect(out).not.toContain("bogus");
  });
});
