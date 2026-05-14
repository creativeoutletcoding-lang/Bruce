"use client";

import { useEffect, useRef } from "react";

interface UseChatMemoryOptions {
  chatId: string;
  /** Latest message count — used to decide if there's enough history to summarize. */
  messageCount: number;
  /** When true (incognito), suppress the unmount fire entirely. */
  disabled?: boolean;
}

// Fire-and-forget memory generation on component unmount. Uses keepalive so the
// browser still ships the request after navigation. Only fires once per mount,
// and only when there are at least two messages to summarize.
export function useChatMemory({ chatId, messageCount, disabled = false }: UseChatMemoryOptions) {
  const firedRef = useRef(false);
  const countRef = useRef(messageCount);
  const disabledRef = useRef(disabled);

  useEffect(() => { countRef.current = messageCount; }, [messageCount]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    return () => {
      if (disabledRef.current) return;
      if (firedRef.current) return;
      if (countRef.current < 2) return;
      firedRef.current = true;
      fetch("/api/memory/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
        keepalive: true,
      }).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
