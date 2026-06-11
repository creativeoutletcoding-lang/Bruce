"use client";

import { useEffect } from "react";

// Keyboard-aware viewport lock for the chat shell (iOS PWA / mobile Safari).
//
// iOS does not resize the layout viewport when the on-screen keyboard opens —
// it overlays the keyboard and force-scrolls the document to reveal the
// focused input, shoving the whole app up and leaving blank space above.
// Instead of padding around the keyboard (the old --keyboard-offset hack),
// the shell sizes itself to the *visual* viewport:
//
//   --app-height     → visualViewport.height; the shell shrinks above the
//                      keyboard so the conversation stays visible
//   --kb-safe-bottom → 0px while the keyboard is open (the home-indicator
//                      area is behind it), env(safe-area-inset-bottom) when
//                      closed
//
// Any forced document scroll is undone immediately, and document-level
// scrolling is locked while the shell is mounted (every chat surface scrolls
// internally). Content pages (login, terms) don't mount this hook and keep
// normal body scroll.
export function useVisualViewportLock() {
  useEffect(() => {
    const root = document.documentElement;
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    const vv = window.visualViewport;
    if (!vv) {
      return () => {
        document.body.style.overflow = prevOverflow;
        document.body.style.overscrollBehavior = prevOverscroll;
      };
    }

    const update = () => {
      // Pinch-zoomed states report a shrunken visual viewport — don't let
      // accessibility zoom collapse the shell.
      if (vv.scale && Math.abs(vv.scale - 1) > 0.01) return;
      root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      const keyboardOpen = window.innerHeight - vv.height > 50;
      root.style.setProperty(
        "--kb-safe-bottom",
        keyboardOpen ? "0px" : "env(safe-area-inset-bottom, 0px)"
      );
      // Undo iOS's forced document scroll on input focus — this is the
      // "app jumps to the top leaving empty space" bug.
      if (keyboardOpen && (window.scrollY !== 0 || vv.offsetTop > 0)) {
        window.scrollTo(0, 0);
      }
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--kb-safe-bottom");
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);
}
