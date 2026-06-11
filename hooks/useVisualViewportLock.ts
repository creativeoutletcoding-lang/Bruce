"use client";

import { useEffect } from "react";

// Keyboard-aware viewport lock for the chat shell (iOS PWA / mobile Safari).
//
// iOS does not resize the layout viewport when the on-screen keyboard opens —
// it overlays the keyboard and shifts the *visual* viewport down to reveal the
// focused input, shoving the whole app up and leaving blank space above. The
// fix is to follow that shift instead of fighting it: the shell is
// position:fixed and pinned to the visual viewport on every frame.
//
//   --app-height     → visualViewport.height; the shell shrinks above the
//                      keyboard so the conversation stays visible
//   --vv-offset-top  → visualViewport.offsetTop; the shell's `top` tracks how
//                      far iOS shifted the visual viewport, so it always
//                      overlays the visible strip exactly. This is the piece
//                      the old hook lacked — it tried window.scrollTo(0,0),
//                      which moves the LAYOUT viewport and cannot cancel a
//                      VISUAL-viewport offset, so the app still jumped.
//   --kb-safe-bottom → 0px while the keyboard is open (the home-indicator
//                      area is behind it), env(safe-area-inset-bottom) when
//                      closed
//
// Document-level scrolling is locked while the shell is mounted (every chat
// surface scrolls internally). Content pages (login, terms) don't mount this
// hook and keep normal body scroll.
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
      const keyboardOpen = window.innerHeight - vv.height > 50;
      root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      // Only follow the visual-viewport offset while the keyboard is actually
      // open. When it's closed, transient page-level scrolls (scrollIntoView
      // on chat open, rubber-banding) briefly report a nonzero offsetTop —
      // tracking those would shift the fixed shell and snap it back, which
      // reads as a jump on open. Pin to 0 instead.
      root.style.setProperty(
        "--vv-offset-top",
        keyboardOpen ? `${Math.round(vv.offsetTop)}px` : "0px"
      );
      root.style.setProperty(
        "--kb-safe-bottom",
        keyboardOpen ? "0px" : "env(safe-area-inset-bottom, 0px)"
      );
    };

    // Coalesce the burst of resize/scroll events iOS fires during the keyboard
    // transition into one update per frame — avoids layout thrash and jitter.
    let rafId = 0;
    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    };

    update();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--vv-offset-top");
      root.style.removeProperty("--kb-safe-bottom");
      document.body.style.overflow = prevOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);
}
