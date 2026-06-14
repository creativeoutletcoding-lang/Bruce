import { describe, it, expect, vi } from "vitest";
import {
  shouldEngagementGate,
  buildEngagementHistory,
  buildNameForSender,
  type RawEngagementRow,
} from "@/lib/chat/engagementContext";

describe("shouldEngagementGate (single-member vs group)", () => {
  it("does NOT gate a single-member project (always respond)", () => {
    expect(shouldEngagementGate(1)).toBe(false);
  });
  it("does NOT gate an empty/zero-member project", () => {
    expect(shouldEngagementGate(0)).toBe(false);
  });
  it("gates a group project (>1 member)", () => {
    expect(shouldEngagementGate(2)).toBe(true);
    expect(shouldEngagementGate(5)).toBe(true);
  });
});

describe("buildEngagementHistory", () => {
  it("preserves sender_id and keeps Bruce turns (sender_id null)", () => {
    const rows: RawEngagementRow[] = [
      { role: "user", content: "dinner?", sender_id: "u1", metadata: null },
      { role: "assistant", content: "Want me to book a table?", sender_id: null, metadata: null },
    ];
    const h = buildEngagementHistory(rows);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ role: "user", content: "dinner?", sender_id: "u1" });
    expect(h[1]).toMatchObject({ role: "assistant", sender_id: null });
    expect(h[1].content).toContain("book a table");
  });

  it("drops empty messages", () => {
    const rows: RawEngagementRow[] = [
      { role: "user", content: "   ", sender_id: "u1", metadata: null },
      { role: "user", content: "real", sender_id: "u2", metadata: null },
    ];
    expect(buildEngagementHistory(rows).map((m) => m.content)).toEqual(["real"]);
  });

  it("substitutes a placeholder for attachment-only member messages", () => {
    const rows: RawEngagementRow[] = [
      { role: "user", content: "", sender_id: "u1", metadata: { attachments: [{ type: "image" }] } },
      { role: "user", content: "", sender_id: "u2", metadata: { attachments: [{ type: "document", filename: "tax.pdf" }] } },
    ];
    const h = buildEngagementHistory(rows);
    expect(h[0].content).toBe("[image]");
    expect(h[1].content).toBe("[document: tax.pdf]");
  });
});

describe("buildNameForSender", () => {
  function fakeSupabase(rows: Array<{ id: string; name: string }>) {
    return {
      from: () => ({
        select: () => ({
          in: () => Promise.resolve({ data: rows }),
        }),
      }),
    } as unknown as Parameters<typeof buildNameForSender>[0];
  }

  it("maps Bruce (null) → 'Bruce', the current user without a lookup, and resolved members", async () => {
    const inSpy = vi.fn(() => Promise.resolve({ data: [{ id: "u2", name: "Laurianne" }] }));
    const supa = { from: () => ({ select: () => ({ in: inSpy }) }) } as unknown as Parameters<typeof buildNameForSender>[0];
    const history = [
      { role: "user", content: "hi", sender_id: "u1" },
      { role: "user", content: "yo", sender_id: "u2" },
      { role: "assistant", content: "hello", sender_id: null },
    ];
    const nameFor = await buildNameForSender(supa, history, "u1", "Jake");
    expect(nameFor(null)).toBe("Bruce");
    expect(nameFor("u1")).toBe("Jake"); // current user, supplied directly
    expect(nameFor("u2")).toBe("Laurianne"); // resolved via lookup
    expect(nameFor("u99")).toBe("Member"); // unknown id
    // current user must be excluded from the lookup set
    expect(inSpy).toHaveBeenCalledWith("id", ["u2"]);
  });

  it("skips the DB lookup entirely when the only speaker is the current user", async () => {
    const supa = fakeSupabase([]);
    const spy = vi.spyOn(supa, "from");
    const history = [{ role: "user", content: "hi", sender_id: "u1" }];
    const nameFor = await buildNameForSender(supa, history, "u1", "Jake");
    expect(nameFor("u1")).toBe("Jake");
    expect(spy).not.toHaveBeenCalled();
  });
});
