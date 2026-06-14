// Shared multi-member engagement decision — the speaker-aware, context-aware
// judgment of whether a message in a group room is addressed to Bruce and
// warrants a response.
//
// This is the canonical awareness mechanism. The family route calls it today;
// the group-project route is intended to call it unchanged later (convergence-
// spec fork #2 / D3). Keep the pure helpers free of route/DB/Anthropic coupling
// so they stay testable and reusable.
//
// Outcome set is preserved from the original family gate: respond / react_thumbs
// / react_heart / silent. This module upgrades the INPUTS and QUALITY of the
// decision — speaker-labeled history, an open-question window, and address-vs-
// mention discrimination — not the outcomes.

import type Anthropic from "@anthropic-ai/sdk";

export type EngagementDecision = "respond" | "react_thumbs" | "react_heart" | "silent";

// ── Tunables ─────────────────────────────────────────────────────────────────

// How many MEMBER (human) messages after one of Bruce's questions/proposals a
// nameless reply ("yeah", "sure", "go ahead", "do it") is still treated as a
// candidate answer to Bruce. The hard count bounds when the "is this answering
// Bruce?" path is live; WITHIN the window the semantic judgment (real reply vs
// unrelated member-to-member chatter) is delegated to the classifier, which is
// given Bruce's pending question explicitly. Single, obvious, tunable knob.
export const OPEN_QUESTION_WINDOW = 3;

// How many recent turns of speaker-labeled history the classifier sees.
export const CLASSIFIER_HISTORY_TURNS = 8;

// ── Types ────────────────────────────────────────────────────────────────────

export interface EngagementHistoryEntry {
  /** "user" (a member) or "assistant" (Bruce). */
  role: string;
  content: string;
  /** null = Bruce; otherwise the member's user id. */
  sender_id: string | null;
}

export interface EngagementInput {
  anthropic: Anthropic;
  /** Classifier model (e.g. HAIKU_MODEL) — passed in so the module stays model-agnostic. */
  model: string;
  /** The newest message text (the one being judged). */
  message: string;
  /** Display name of the newest message's sender. */
  senderName: string;
  /** Prior messages in chronological order (NOT including the newest message). */
  history: EngagementHistoryEntry[];
  /** Resolve a sender_id to a display name. null → "Bruce". Unknown → "Member". */
  nameForSender: (senderId: string | null) => string;
}

// ── Pure helpers (testable; no I/O) ──────────────────────────────────────────

const MENTIONS_BRUCE = /\bbruce\b/i;

// High-precision "Bruce is being spoken TO" patterns. Bare-name mention is
// deliberately NOT here — a third-person mention ("did Bruce add it?") must fall
// through to the classifier, not auto-respond. These only fire on clear address.
const STRONG_ADDRESS_PATTERNS: RegExp[] = [
  /@bruce\b/i, // explicit @mention
  /^\s*bruce\s*[,:!?]/i, // "Bruce, ..." / "Bruce:" / "Bruce?" / "Bruce!" at the start
  /\b(?:hey|hi|hello|ok|okay|yo|thanks|thank you|please)\s*,?\s+bruce\b/i, // greeting/thanks + Bruce
  /,\s*bruce\b\s*[?!.]*\s*$/i, // "..., bruce" trailing vocative
  /\bbruce\s*[?!]+\s*$/i, // "...bruce?" / "...bruce!" trailing vocative
];

/** True when Bruce is clearly being addressed (vocative / @mention), not merely mentioned. */
export function isStronglyAddressed(message: string): boolean {
  return STRONG_ADDRESS_PATTERNS.some((re) => re.test(message));
}

/** True when the message contains Bruce's name at all (address OR mention). */
export function mentionsBruce(message: string): boolean {
  return MENTIONS_BRUCE.test(message);
}

// Phrases that mark a Bruce turn as a proposal awaiting a yes/no even without a
// literal "?" — so "I can add it to the calendar." then a member "go ahead" is
// caught inside the window.
const PROPOSAL_RE =
  /\b(?:want me to|should i|shall i|do you want|would you like|i can|i could|let me|ready for me to|i'll go ahead|say the word)\b/i;

/** A Bruce turn counts as open if it asks a question or floats an explicit proposal. */
export function isQuestionOrProposal(text: string): boolean {
  return text.includes("?") || PROPOSAL_RE.test(text);
}

// formatAssistantReplay appends a "[Tool results from this turn:…]" block after
// Bruce's text; strip it so the classifier sees the actual question, not traces.
function stripToolTrace(text: string): string {
  const idx = text.indexOf("\n\n[Tool results from this turn:");
  return (idx === -1 ? text : text.slice(0, idx)).trim();
}

export interface PendingQuestion {
  /** Bruce's question/proposal text (tool-trace stripped). */
  text: string;
  /** Member messages that have arrived since Bruce asked (the incoming is the next one). */
  memberMessagesSince: number;
}

/**
 * Find an OPEN question from Bruce: scan back to the most recent Bruce turn,
 * counting member messages on the way. If that turn is a question/proposal and
 * fewer than OPEN_QUESTION_WINDOW member messages have arrived since (so the
 * incoming message is within the window), it's live. Computed ephemerally from
 * history — no stored state.
 */
export function findPendingOpenQuestion(
  history: EngagementHistoryEntry[]
): PendingQuestion | null {
  let memberMessagesSince = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const isBruce = m.sender_id === null;
    if (isBruce) {
      // Most recent Bruce turn reached. Live only if it's a question/proposal
      // and the incoming message is still inside the window.
      if (memberMessagesSince < OPEN_QUESTION_WINDOW && isQuestionOrProposal(m.content)) {
        return { text: stripToolTrace(m.content), memberMessagesSince };
      }
      return null;
    }
    memberMessagesSince++;
    // Too many member messages have passed; even an earlier Bruce question is stale.
    if (memberMessagesSince >= OPEN_QUESTION_WINDOW) return null;
  }
  return null;
}

/** Speaker-labeled transcript line: "Bruce: …" or "Laurianne: …" — never "Member". */
function labelFor(entry: EngagementHistoryEntry, nameForSender: (id: string | null) => string): string {
  return entry.sender_id === null ? "Bruce" : nameForSender(entry.sender_id);
}

export function buildTranscript(
  history: EngagementHistoryEntry[],
  nameForSender: (id: string | null) => string,
  turns: number = CLASSIFIER_HISTORY_TURNS
): string {
  return history
    .slice(-turns)
    .map((m) => `${labelFor(m, nameForSender)}: ${m.content.slice(0, 200)}`)
    .join("\n");
}

// ── Classifier ───────────────────────────────────────────────────────────────

const GATE_PROMPT = `You are the engagement gate for Bruce, a family/group-chat AI assistant. The conversation has multiple human members AND Bruce; every line is labeled with who said it. Decide how Bruce should engage with the NEWEST message. Reply with exactly one word:

RESPOND — Bruce is addressed: a member asks Bruce for information, a suggestion, a recommendation, a lookup, or a task clearly directed at the assistant even without naming him; OR the newest message is a reply/confirmation to a question or proposal Bruce just made (including brief ones like "yeah", "sure", "go ahead", "do it").
REACT_THUMBS — purely informational (news, an update, a confirmation) where a silent thumbs-up fits and text would add nothing.
REACT_HEART — warm, personal, or emotionally significant: a kind gesture, a family moment, something lovingly shared.
SILENT — members are talking TO EACH OTHER, venting, celebrating together, talking ABOUT Bruce rather than to him, or Bruce's input was not invited.

Use the speaker labels to tell who is addressing whom. A message that merely mentions "Bruce" in the third person between two members ("did Bruce add it?") is talk ABOUT Bruce → SILENT, not RESPOND. Lean toward SILENT over reacting — reactions still signal presence and feel intrusive if overused. When in doubt, stay silent.`;

function parseDecision(word: string): EngagementDecision {
  const w = word.trim().toUpperCase();
  if (w.startsWith("RESPOND")) return "respond";
  if (w.startsWith("REACT_THUMBS")) return "react_thumbs";
  if (w.startsWith("REACT_HEART")) return "react_heart";
  return "silent";
}

/**
 * Decide whether/how Bruce should engage with the newest message.
 *
 * 1. Clear address (vocative / @mention) → respond immediately.
 * 2. Otherwise build speaker-aware context for the classifier, injecting Bruce's
 *    pending open question (when live) and an address-vs-mention note (when the
 *    name appears), and let the classifier judge.
 * Classifier failure falls back to SILENT (stay out — the safe default).
 */
export async function decideEngagement(input: EngagementInput): Promise<EngagementDecision> {
  const { anthropic, model, message, senderName, history, nameForSender } = input;

  // (1) Unambiguous address short-circuits to respond. Bare-name mention does NOT.
  if (isStronglyAddressed(message)) return "respond";

  try {
    const transcript = buildTranscript(history, nameForSender);
    const pending = findPendingOpenQuestion(history);

    const pendingLine = pending
      ? `\n\nBruce recently said, and may be awaiting a reply (within ${OPEN_QUESTION_WINDOW} member messages): "${pending.text.slice(0, 300)}"\nIf the newest message is a reply or confirmation to that — including a brief one like "yeah", "sure", "go ahead", "do it" — choose RESPOND. If it is unrelated member-to-member talk, do not.`
      : "";

    const mentionLine = mentionsBruce(message)
      ? `\n\nNote: the newest message contains the word "Bruce". Decide from the speaker labels whether Bruce is being ADDRESSED (spoken TO → RESPOND) or merely MENTIONED between members (spoken ABOUT → usually SILENT).`
      : "";

    const res = await anthropic.messages.create({
      model,
      max_tokens: 8,
      system: GATE_PROMPT,
      messages: [
        {
          role: "user",
          content: `Recent conversation:\n${transcript || "(none)"}${pendingLine}${mentionLine}\n\nNewest message, from ${senderName}: ${message.slice(0, 500)}\n\nDecision:`,
        },
      ],
    });
    const word = res.content[0]?.type === "text" ? res.content[0].text : "";
    return parseDecision(word);
  } catch {
    return "silent"; // classifier failure → stay out (the safe default)
  }
}
