import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { decideEngagement, type EngagementHistoryEntry } from "@/lib/chat/engagement";

const BRUCE = (content: string): EngagementHistoryEntry => ({ role: "assistant", content, sender_id: null });
const MEMBER = (content: string, id = "u1"): EngagementHistoryEntry => ({ role: "user", content, sender_id: id });

// Minimal Anthropic stub: messages.create resolves to a single text block.
function fakeAnthropic(word: string, createImpl?: (args: unknown) => void) {
  const create = vi.fn(async (args: unknown) => {
    createImpl?.(args);
    return { content: [{ type: "text", text: word }] };
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const nameForSender = (id: string | null) =>
  id === null ? "Bruce" : ({ u1: "Jake", u2: "Laurianne" } as Record<string, string>)[id] ?? "Member";

type Input = Parameters<typeof decideEngagement>[0];
const base = (overrides: Pick<Input, "anthropic"> & Partial<Input>): Input => ({
  model: "haiku",
  message: "",
  senderName: "Jake",
  history: [] as EngagementHistoryEntry[],
  nameForSender,
  ...overrides,
});

describe("decideEngagement — group project wiring", () => {
  it("responds to a direct address WITHOUT calling the classifier", async () => {
    const { client, create } = fakeAnthropic("SILENT"); // would say silent if asked
    const decision = await decideEngagement(base({ anthropic: client, message: "Bruce, add milk to the list" }));
    expect(decision).toBe("respond");
    expect(create).not.toHaveBeenCalled(); // short-circuited on strong address
  });

  it("stays silent on member-to-member chatter (classifier says SILENT)", async () => {
    const { client, create } = fakeAnthropic("SILENT");
    const decision = await decideEngagement(
      base({
        anthropic: client,
        message: "haha yeah that was wild",
        history: [MEMBER("did you see the game?", "u2"), MEMBER("yeah crazy ending", "u1")],
      })
    );
    expect(decision).toBe("silent");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("responds to a nameless answer within the open-question window, passing Bruce's pending question to the classifier", async () => {
    let promptSent = "";
    const { client, create } = fakeAnthropic("RESPOND", (args) => {
      const a = args as { messages: Array<{ content: string }> };
      promptSent = a.messages[0].content;
    });
    const decision = await decideEngagement(
      base({
        anthropic: client,
        message: "yeah go ahead", // nameless confirmation
        history: [MEMBER("dinner plans?", "u2"), BRUCE("Want me to book a table for 6?")],
      })
    );
    expect(decision).toBe("respond");
    expect(create).toHaveBeenCalledTimes(1);
    // The pending open question must be surfaced to the classifier.
    expect(promptSent).toContain("book a table for 6");
  });

  it("falls back to SILENT when the classifier call throws", async () => {
    const create = vi.fn(async () => { throw new Error("api down"); });
    const client = { messages: { create } } as unknown as Anthropic;
    const decision = await decideEngagement(base({ anthropic: client, message: "what's for dinner" }));
    expect(decision).toBe("silent");
  });

  it("maps classifier reactions through to react outcomes", async () => {
    const heart = await decideEngagement(base({ anthropic: fakeAnthropic("REACT_HEART").client, message: "love you all" }));
    expect(heart).toBe("react_heart");
    const thumbs = await decideEngagement(base({ anthropic: fakeAnthropic("REACT_THUMBS").client, message: "flight landed safely" }));
    expect(thumbs).toBe("react_thumbs");
  });
});
