"use client";

// Shared shared-browser panel state + lifecycle, used identically by the
// standalone, project, and family chat wrappers (CHAT LOGIC RULE — cross-context
// behavior lives in a shared hook, never duplicated in the wrappers).
//
// Responsibilities:
//   - hold the panel's open/session state
//   - openBrowser(): create the session via POST and open the panel (globe tap)
//   - toggleBrowser(): hide/show an already-open panel
//   - closeBrowser(): release the Browserbase session via DELETE and unmount
//   - applyBrowserEvent(evt): fold a browser_event from the chat stream (Bruce
//     opened/moved the browser) into the panel state

import { useCallback, useRef, useState } from "react";
import type { BrowserEvent } from "@/lib/chat/clientStream";

export interface BrowserPanelState {
  open: boolean;
  sessionId: string | null;
  liveViewUrl: string | null;
  currentUrl: string | null;
}

const CLOSED: BrowserPanelState = { open: false, sessionId: null, liveViewUrl: null, currentUrl: null };

export interface UseBrowserPanel {
  panel: BrowserPanelState;
  /** True while a session is being created from the globe button. */
  opening: boolean;
  /** Tap the globe: create-or-reveal the shared browser. */
  openBrowser: () => Promise<void>;
  /** Show/hide an already-created panel without ending the session. */
  toggleBrowser: () => void;
  /** Close the panel and release the Browserbase session. */
  closeBrowser: () => Promise<void>;
  /** Fold a stream browser_event (from Bruce) into the panel. */
  applyBrowserEvent: (evt: BrowserEvent | null) => void;
}

export function useBrowserPanel(chatId: string, enabled: boolean): UseBrowserPanel {
  const [panel, setPanel] = useState<BrowserPanelState>(CLOSED);
  const [opening, setOpening] = useState(false);
  const hasSessionRef = useRef(false);

  const openBrowser = useCallback(async () => {
    if (!enabled || opening) return;
    // Already have a session → just reveal the panel.
    if (hasSessionRef.current) {
      setPanel((p) => ({ ...p, open: true }));
      return;
    }
    setOpening(true);
    try {
      const res = await fetch("/api/browser/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { sessionId: string; liveViewUrl: string; currentUrl?: string };
      hasSessionRef.current = true;
      setPanel({
        open: true,
        sessionId: data.sessionId,
        liveViewUrl: data.liveViewUrl,
        currentUrl: data.currentUrl ?? null,
      });
    } catch {
      /* surfaced by the panel's own connecting/disconnected states */
    } finally {
      setOpening(false);
    }
  }, [chatId, enabled, opening]);

  const toggleBrowser = useCallback(() => {
    setPanel((p) => (p.sessionId ? { ...p, open: !p.open } : p));
  }, []);

  const closeBrowser = useCallback(async () => {
    setPanel(CLOSED);
    hasSessionRef.current = false;
    try {
      await fetch("/api/browser/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId }),
      });
    } catch {
      /* best effort — session also auto-releases on Browserbase timeout */
    }
  }, [chatId]);

  const applyBrowserEvent = useCallback((evt: BrowserEvent | null) => {
    if (!evt) return;
    hasSessionRef.current = true;
    setPanel((p) => {
      // Don't reopen a panel the user explicitly closed mid-stream, but always
      // open on a fresh Bruce-initiated session.
      const open = evt.isNew || p.open || p.sessionId === evt.sessionId;
      return {
        open: open || evt.isNew,
        sessionId: evt.sessionId,
        liveViewUrl: evt.liveViewUrl,
        currentUrl: evt.currentUrl,
      };
    });
  }, []);

  return { panel, opening, openBrowser, toggleBrowser, closeBrowser, applyBrowserEvent };
}
