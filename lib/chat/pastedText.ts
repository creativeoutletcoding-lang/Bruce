// Strip <attached_text> blocks from a message before storing, displaying, or
// building the optimistic bubble. The full content (with blocks) still goes to
// the Anthropic API so Bruce has the pasted context.
//
// When only pasted text was sent (no typed text), a human-readable summary
// ("Pasted text · N words · N lines") is returned so the bubble isn't empty.
export function buildDisplayMessage(message: string): string {
  const summaries: string[] = [];
  const stripped = message
    .replace(/<attached_text[^>]*>([\s\S]*?)<\/attached_text>/g, (_: string, content: string) => {
      const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
      const lineCount = content.split("\n").length;
      summaries.push(`Pasted text · ${wordCount} words · ${lineCount} lines`);
      return "";
    })
    .trim();
  if (summaries.length > 0 && stripped) return `${summaries.join("\n")}\n\n${stripped}`;
  return stripped || summaries.join("\n") || message;
}
