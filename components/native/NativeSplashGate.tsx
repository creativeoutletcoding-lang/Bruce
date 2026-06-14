"use client";

import { useEffect } from "react";
import { isNative } from "@/lib/native";
import { hideSplash } from "@/lib/native/splash";

/**
 * Hides the native launch splash the moment the page has painted — on every
 * route (mounted from RootLayout), so login/terms/callback are covered, not
 * just the chat shell. Waiting for paint (double rAF after mount) is what keeps
 * the splash → content transition seamless: the splash stays up until real
 * content is on screen, so there is no black/blank gap. Renders nothing and is
 * a complete no-op on web/desktop (isNative() is false; hideSplash() also
 * guards internally). Pairs with launchAutoHide as a safety net in config.
 */
export default function NativeSplashGate() {
  useEffect(() => {
    if (!isNative()) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        hideSplash();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  return null;
}
