"use client";

import { useMemo } from "react";
import { marked } from "marked";

// The single markdown renderer for assistant text. Both render paths — the
// normal bubble (MessageBubble) and the post-task summary (MessageList's task
// branch) — must use this component so live-stream and history-reload output
// are identical. The task branch previously rendered plain text with
// pre-wrap, which displayed literal **asterisks** on reload.
//
// useMemo throttles parsing to content changes — during streaming that is at
// most once per reveal frame, never per network chunk.
export default function AssistantMarkdown({ content }: { content: string }) {
  const html = useMemo(() => marked(content) as string, [content]);
  return <div className="bruce-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
