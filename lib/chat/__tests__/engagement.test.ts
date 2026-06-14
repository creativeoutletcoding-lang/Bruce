import { describe, it, expect } from "vitest";
import {
  OPEN_QUESTION_WINDOW,
  isStronglyAddressed,
  mentionsBruce,
  isQuestionOrProposal,
  findPendingOpenQuestion,
  buildTranscript,
  type EngagementHistoryEntry,
} from "@/lib/chat/engagement";

const BRUCE = (content: string): EngagementHistoryEntry => ({ role: "assistant", content, sender_id: null });
const MEMBER = (content: string, id = "u1"): EngagementHistoryEntry => ({ role: "user", content, sender_id: id });

describe("OPEN_QUESTION_WINDOW", () => {
  it("is a single tunable constant equal to 3", () => {
    expect(OPEN_QUESTION_WINDOW).toBe(3);
  });
});

describe("isStronglyAddressed (address vs mention)", () => {
  it("fires on clear vocative address", () => {
    expect(isStronglyAddressed("Bruce, can you add it?")).toBe(true);
    expect(isStronglyAddressed("hey bruce what's the weather")).toBe(true);
    expect(isStronglyAddressed("@bruce")).toBe(true);
    expect(isStronglyAddressed("thanks bruce")).toBe(true);
    expect(isStronglyAddressed("can you do that, bruce?")).toBe(true);
  });
  it("does NOT fire on third-person mention between members", () => {
    expect(isStronglyAddressed("did Bruce add it to the calendar?")).toBe(false);
    expect(isStronglyAddressed("I think Bruce already handled that")).toBe(false);
    expect(isStronglyAddressed("ask Bruce later")).toBe(false);
  });
  it("still recognizes the name is present for mention routing", () => {
    expect(mentionsBruce("did Bruce add it?")).toBe(true);
    expect(mentionsBruce("what time is dinner")).toBe(false);
  });
});

describe("isQuestionOrProposal", () => {
  it("treats a literal question as open", () => {
    expect(isQuestionOrProposal("Want me to put it on the calendar?")).toBe(true);
  });
  it("treats an explicit proposal without '?' as open", () => {
    expect(isQuestionOrProposal("I can add it to the calendar.")).toBe(true);
    expect(isQuestionOrProposal("Let me draft that for you.")).toBe(true);
  });
  it("does not treat a plain statement as open", () => {
    expect(isQuestionOrProposal("Done — it's on the calendar.")).toBe(false);
  });
});

describe("findPendingOpenQuestion (open-question window)", () => {
  it("is live when Bruce just asked and the incoming is the next message", () => {
    const history = [MEMBER("dinner plans?"), BRUCE("Want me to book a table?")];
    const pending = findPendingOpenQuestion(history);
    expect(pending).not.toBeNull();
    expect(pending!.memberMessagesSince).toBe(0);
    expect(pending!.text).toContain("book a table");
  });

  it("is live for an implicit proposal awaiting confirmation", () => {
    const history = [BRUCE("I can add it to the calendar.")];
    expect(findPendingOpenQuestion(history)).not.toBeNull();
  });

  it("stays live up to but not beyond OPEN_QUESTION_WINDOW member messages", () => {
    // Bruce asked, then 2 member messages → incoming would be the 3rd → still live.
    const within = [BRUCE("Want me to book it?"), MEMBER("maybe"), MEMBER("hmm")];
    expect(findPendingOpenQuestion(within)).not.toBeNull();
    // Bruce asked, then 3 member messages → incoming would be the 4th → stale.
    const beyond = [BRUCE("Want me to book it?"), MEMBER("maybe"), MEMBER("hmm"), MEMBER("idk")];
    expect(findPendingOpenQuestion(beyond)).toBeNull();
  });

  it("is null when Bruce's most recent turn was not a question/proposal", () => {
    const history = [BRUCE("Want me to book it?"), MEMBER("yes"), BRUCE("Done, booked for 7pm.")];
    expect(findPendingOpenQuestion(history)).toBeNull();
  });

  it("strips the tool-trace block from the pending question text", () => {
    const history = [BRUCE("Want me to book it?\n\n[Tool results from this turn:\n- web_search: ...]")];
    const pending = findPendingOpenQuestion(history);
    expect(pending!.text).toBe("Want me to book it?");
  });
});

describe("buildTranscript (speaker-aware labels)", () => {
  it("labels each line with the real sender name, never 'Member'", () => {
    const nameForSender = (id: string | null) =>
      id === null ? "Bruce" : id === "u1" ? "Laurianne" : id === "u2" ? "Jake" : "Member";
    const history = [MEMBER("hi", "u1"), MEMBER("hey", "u2"), BRUCE("Hello both.")];
    const t = buildTranscript(history, nameForSender);
    expect(t).toContain("Laurianne: hi");
    expect(t).toContain("Jake: hey");
    expect(t).toContain("Bruce: Hello both.");
    expect(t).not.toContain("Member:");
  });
});
