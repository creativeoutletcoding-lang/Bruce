"use client";

import { useEffect } from "react";
import { isNative } from "@/lib/native";

// Keyboard-aware viewport lock for the chat shell (iOS PWA / mobile Safari).
//
// NATIVE SHELL: the visual-viewport tracking is bypassed. lib/native/keyboard.ts
// owns the keyboard on native (KeyboardResize.None + keyboardWillShow/WillHide):
// it drives --app-height and --kb-safe-bottom directly from the keyboard
// animation so the input leads the slide. Here we only set the RESTING values
// and lock document scroll: --app-height: 100% (100% of the fixed containing
// block = the full frame; keyboard.ts shrinks it on keyboardWillShow) and
// --vv-offset-top: 0px. We must NOT leave --app-height to fall back to 100dvh
// (dvh lagged the change). --kb-safe-bottom is left unset → env(safe-area-inset-
// bottom) at rest; keyboard.ts zeroes it while the keyboard is up.
// This hook stays fully functional for web/desktop/PWA; it can be deleted once
// native is the only mobile target.
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

    // Native shell: OS keyboard resize replaces the visual-viewport hack. Keep
    // the document scroll lock, and pin the shell to the resized frame with
    // 100% (instant) instead of letting it fall back to the lagging 100dvh.
    // Skip the vv listeners entirely. (See header comment for the full why.)
    if (isNative()) {
      root.style.setProperty("--app-height", "100%");
      root.style.setProperty("--vv-offset-top", "0px");
      return () => {
        root.style.removeProperty("--app-height");
        root.style.removeProperty("--vv-offset-top");
        document.body.style.overflow = prevOverflow;
        document.body.style.overscrollBehavior = prevOverscroll;
      };
    }

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
