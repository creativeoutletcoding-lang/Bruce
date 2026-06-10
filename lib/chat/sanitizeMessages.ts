import type Anthropic from "@anthropic-ai/sdk";

// ── History sanitization ─────────────────────────────────────────────────────
// Anthropic rejects non-alternating user/assistant messages. Failed previous
// turns can leave the DB with two user messages in a row; merge those into a
// single message (never drop content — an earlier user message may carry the
// question Bruce is being asked to answer).

type MessageContent = Anthropic.Messages.MessageParam["content"];

function toBlocks(content: MessageContent): Anthropic.Messages.ContentBlockParam[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  return [...content];
}

function mergeContent(a: MessageContent, b: MessageContent): MessageContent {
  if (typeof a === "string" && typeof b === "string") {
    if (!a.trim()) return b;
    if (!b.trim()) return a;
    return `${a}\n\n${b}`;
  }
  return [...toBlocks(a), ...toBlocks(b)];
}

export function sanitizeAlternatingMessages(
  raw: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
  return raw
    .reduce<Anthropic.Messages.MessageParam[]>((acc, msg) => {
      if (acc.length > 0 && acc[acc.length - 1].role === msg.role) {
        const prev = acc[acc.length - 1];
        acc[acc.length - 1] = { role: prev.role, content: mergeContent(prev.content, msg.content) };
      } else {
        acc.push(msg);
      }
      return acc;
    }, [])
    .filter((_, i, arr) => i !== 0 || arr[0].role === "user");
}
