// Strip <attached_text> blocks from a message before storing, displaying, or
// building the optimistic bubble. The full content (with blocks) still goes to
// the Anthropic API so Bruce has the pasted context.

export interface PastedAttachmentData {
  wordCount: number;
  lineCount: number;
  content: string;
}

// Parse out every <attached_text> block, returning structured attachment data
// alongside the display string. Use this anywhere you need the full content
// (server metadata storage, optimistic message construction).
export function parsePastedAttachments(message: string): {
  displayMessage: string;
  pastedAttachments: PastedAttachmentData[];
} {
  const pastedAttachments: PastedAttachmentData[] = [];
  const stripped = message
    .replace(/<attached_text[^>]*>([\s\S]*?)<\/attached_text>/g, (_: string, content: string) => {
      const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
      const lineCount = content.split("\n").length;
      pastedAttachments.push({ wordCount, lineCount, content });
      return "";
    })
    .trim();

  const summaries = pastedAttachments.map(
    (a) => `Pasted text · ${a.wordCount} words · ${a.lineCount} lines`
  );
  let displayMessage: string;
  if (pastedAttachments.length > 0 && stripped) {
    displayMessage = `${summaries.join("\n")}\n\n${stripped}`;
  } else {
    displayMessage = stripped || summaries.join("\n") || message;
  }

  return { displayMessage, pastedAttachments };
}

// Convenience wrapper for callers that only need the display string.
export function buildDisplayMessage(message: string): string {
  return parsePastedAttachments(message).displayMessage;
}

// Strip leading "Pasted text · N words · N lines" summary lines from stored
// content when the structured pastedAttachments array is available separately.
export function stripPastedSummaries(content: string): string {
  return content
    .replace(/^(?:Pasted text · \d+ words · \d+ lines\n?)+\n*/m, "")
    .trim();
}
