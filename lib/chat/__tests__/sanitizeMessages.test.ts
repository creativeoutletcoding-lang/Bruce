import { describe, it, expect } from "vitest";
import { sanitizeAlternatingMessages } from "@/lib/chat/sanitizeMessages";
import type Anthropic from "@anthropic-ai/sdk";

type Msg = Anthropic.Messages.MessageParam;

describe("sanitizeAlternatingMessages", () => {
  it("passes through already-alternating messages unchanged", () => {
    const msgs: Msg[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "how are you" },
    ];
    expect(sanitizeAlternatingMessages(msgs)).toEqual(msgs);
  });

  it("merges adjacent same-role string messages without losing content", () => {
    const msgs: Msg[] = [
      { role: "user", content: "first question" },
      { role: "user", content: "second question" },
      { role: "assistant", content: "answer" },
    ];
    const out = sanitizeAlternatingMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[0].content).toBe("first question\n\nsecond question");
    expect(out[1].content).toBe("answer");
  });

  it("merges string + block content into a block array", () => {
    const msgs: Msg[] = [
      { role: "user", content: "look at this" },
      {
        role: "user",
        content: [{ type: "text", text: "and this" }],
      },
    ];
    const out = sanitizeAlternatingMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].content).toEqual([
      { type: "text", text: "look at this" },
      { type: "text", text: "and this" },
    ]);
  });

  it("drops empty strings when merging", () => {
    const msgs: Msg[] = [
      { role: "user", content: "real content" },
      { role: "user", content: "   " },
    ];
    const out = sanitizeAlternatingMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("real content");
  });

  it("drops a leading assistant message", () => {
    const msgs: Msg[] = [
      { role: "assistant", content: "orphaned" },
      { role: "user", content: "hi" },
    ];
    const out = sanitizeAlternatingMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });

  it("merges three same-role messages in a row", () => {
    const msgs: Msg[] = [
      { role: "user", content: "a" },
      { role: "user", content: "b" },
      { role: "user", content: "c" },
    ];
    const out = sanitizeAlternatingMessages(msgs);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("a\n\nb\n\nc");
  });
});
