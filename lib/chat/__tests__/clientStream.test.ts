import { describe, it, expect } from "vitest";
import {
  parseStreamFrame,
  finalizeStream,
  extractImageRequest,
  resolveAbandonedTaskSteps,
} from "@/lib/chat/clientStream";
import type { TaskProgressData } from "@/lib/chat/taskProgress";

describe("parseStreamFrame", () => {
  it("returns plain text untouched", () => {
    const tick = parseStreamFrame("Hello there.");
    expect(tick.display).toBe("Hello there.");
    expect(tick.task).toBeNull();
    expect(tick.workingStatus).toBeNull();
    expect(tick.browserEvent).toBeNull();
  });

  it("strips STATUS sentinels and reports the latest one", () => {
    const tick = parseStreamFrame("\x1eSTATUS:Thinking…\x1e\x1eSTATUS:Searching the web…\x1e");
    expect(tick.display).toBe("");
    expect(tick.workingStatus).toBe("Searching the web…");
  });

  it("an empty STATUS payload clears the indicator", () => {
    const tick = parseStreamFrame("\x1eSTATUS:Thinking…\x1e\x1eSTATUS:\x1eHello");
    expect(tick.workingStatus).toBe("");
    expect(tick.display).toBe("Hello");
  });

  it("builds task progress from TASK_PROGRESS sentinels", () => {
    const raw =
      '\x1eTASK_PROGRESS:{"step":"Read spreadsheet","status":"done","detail":"42 rows"}\x1e' +
      '\x1eTASK_PROGRESS:{"step":"Write output","status":"error"}\x1e';
    const tick = parseStreamFrame(raw);
    expect(tick.display).toBe("");
    expect(tick.task).not.toBeNull();
    expect(tick.task!.steps).toHaveLength(2);
    expect(tick.task!.steps[0]).toMatchObject({ label: "Read spreadsheet", status: "done", detail: "42 rows" });
    expect(tick.task!.steps[1]).toMatchObject({ label: "Write output", status: "error" });
  });

  it("strips BROWSER_EVENT sentinels and surfaces the latest event", () => {
    const ev = { sessionId: "s1", liveViewUrl: "https://lv", currentUrl: "https://x.com", isNew: true };
    const tick = parseStreamFrame(`before\x1eBROWSER_EVENT:${JSON.stringify(ev)}\x1eafter`);
    expect(tick.display).toBe("beforeafter");
    expect(tick.browserEvent).toEqual(ev);
  });

  it("strips image_request blocks from display text", () => {
    const tick = parseStreamFrame('<image_request>{"prompt":"a cat","quality":"standard"}</image_request>');
    expect(tick.display).toBe("");
  });

  it("treats \\x1f as a stream terminator for display text", () => {
    const tick = parseStreamFrame('visible text\x1fIMAGE_REQ:{"prompt":"p","quality":"standard","chatId":"c"}');
    expect(tick.display).toBe("visible text");
  });

  it("ignores malformed sentinel JSON without crashing", () => {
    const tick = parseStreamFrame("\x1eTASK_PROGRESS:{not json}\x1eok");
    expect(tick.display).toBe("ok");
    expect(tick.task).toBeNull();
  });

  it("returns an empty workingLog for plain no-tool replies", () => {
    const tick = parseStreamFrame("Just a normal answer.");
    expect(tick.workingLog).toEqual([]);
    expect(tick.display).toBe("Just a normal answer.");
  });

  it("routes text before NARRATION_BREAK to the working log, after it to the reply", () => {
    const tick = parseStreamFrame(
      "Let me read the sheet…\x1eNARRATION_BREAK\x1e" +
        '\x1eTASK_PROGRESS:{"step":"Read spreadsheet","status":"done"}\x1e' +
        "Here is the polished reply."
    );
    expect(tick.display).toBe("Here is the polished reply.");
    expect(tick.workingLog).toEqual([
      { kind: "narration", text: "Let me read the sheet…" },
      { kind: "tool", label: "Read spreadsheet", status: "done" },
    ]);
  });

  it("interleaves multiple narration segments and tool events chronologically", () => {
    const tick = parseStreamFrame(
      "First note\x1eNARRATION_BREAK\x1e" +
        '\x1eTASK_PROGRESS:{"step":"Read CSV","status":"done","detail":"3 rows"}\x1e' +
        "Second note\x1eNARRATION_BREAK\x1e" +
        '\x1eTASK_PROGRESS:{"step":"Write output","status":"error"}\x1e' +
        "Final reply"
    );
    expect(tick.display).toBe("Final reply");
    expect(tick.workingLog).toEqual([
      { kind: "narration", text: "First note" },
      { kind: "tool", label: "Read CSV", status: "done", detail: "3 rows" },
      { kind: "narration", text: "Second note" },
      { kind: "tool", label: "Write output", status: "error" },
    ]);
  });

  it("skips empty narration segments", () => {
    const tick = parseStreamFrame("\x1eNARRATION_BREAK\x1eReply");
    expect(tick.display).toBe("Reply");
    expect(tick.workingLog).toEqual([]);
  });

  it("PROMOTE_LAST surfaces the last narration as the reply", () => {
    const tick = parseStreamFrame(
      "Only narration here\x1eNARRATION_BREAK\x1e" +
        '\x1eTASK_PROGRESS:{"step":"Send email","status":"done"}\x1e' +
        "\x1ePROMOTE_LAST\x1e"
    );
    expect(tick.display).toBe("Only narration here");
    expect(tick.workingLog).toEqual([{ kind: "tool", label: "Send email", status: "done" }]);
  });

  it("hides a sentinel split across network chunks until its terminator arrives", () => {
    const tick = parseStreamFrame("visible\x1eSTATUS:Think");
    expect(tick.display).toBe("visible");
  });
});

describe("finalizeStream", () => {
  it("trims the final display text", () => {
    const { display } = finalizeStream("  final answer  ");
    expect(display).toBe("final answer");
  });

  it("strips unclosed task_progress tags", () => {
    const { display } = finalizeStream('done\n<task_progress>{"task":"T","steps":[');
    expect(display).toBe("done");
  });
});

describe("extractImageRequest", () => {
  it("parses the IMAGE_REQ payload", () => {
    const req = extractImageRequest('text\x1fIMAGE_REQ:{"prompt":"a dog","quality":"hd","chatId":"abc"}');
    expect(req).toEqual({ prompt: "a dog", quality: "hd", chatId: "abc" });
  });

  it("returns null when absent or malformed", () => {
    expect(extractImageRequest("no sentinel here")).toBeNull();
    expect(extractImageRequest("x\x1fIMAGE_REQ:{bad")).toBeNull();
  });
});

describe("resolveAbandonedTaskSteps", () => {
  const data: TaskProgressData = {
    task: "T",
    steps: [
      { id: "a", label: "A", status: "done" },
      { id: "b", label: "B", status: "working" },
      { id: "c", label: "C", status: "pending" },
    ],
  };

  it("marks working/pending steps as error on incomplete", () => {
    const out = resolveAbandonedTaskSteps(data, "incomplete");
    expect(out.steps.map((s) => s.status)).toEqual(["done", "error", "error"]);
  });

  it("marks working/pending steps as cancelled on interrupt", () => {
    const out = resolveAbandonedTaskSteps(data, "interrupted");
    expect(out.steps.map((s) => s.status)).toEqual(["done", "cancelled", "cancelled"]);
  });
});
