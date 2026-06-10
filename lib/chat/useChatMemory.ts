"use client";

import { useEffect, useRef } from "react";

interface UseChatMemoryOptions {
  chatId: string;
  /** Latest message count — used to decide if there's enough history to summarize. */
  messageCount: number;
  /** When true (incognito), suppress the unmount fire entirely. */
  disabled?: boolean;
}

// Fire-and-forget memory generation on component unmount OR pagehide. Unmount
// alone is unreliable on iOS PWA — the page is often killed without React ever
// unmounting, so conversations silently generated no memory. pagehide fires
// reliably on iOS when the app is backgrounded/killed. Uses keepalive so the
// browser still ships the request after navigation. Fires at most once per
// mount, and only when there are at least two messages to summarize.
export function useChatMemory({ chatId, messageCount, disabled = false }: UseChatMemoryOptions) {
  const firedRef = useRef(false);
  const countRef = useRef(messageCount);
  const disabledRef = useRef(disabled);

  useEffect(() => { countRef.current = messageCount; }, [messageCount]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  useEffect(() => {
    const fire = () => {
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
    window.addEventListener("pagehide", fire);
    return () => {
      window.removeEventListener("pagehide", fire);
      fire();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
