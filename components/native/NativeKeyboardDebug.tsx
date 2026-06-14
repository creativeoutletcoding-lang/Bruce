"use client";

// TEMP DIAGNOSTIC (feat/native-keyboard-display): live keyboard/viewport metrics
// rendered on-device so we can see whether KeyboardResize.Native actually
// resizes the WKWebView frame under a remote server.url.
//
// Read the numbers when the keyboard opens:
//   - If Native resize WORKS: innerH, clientH AND vvH all shrink together
//     (the native frame got smaller).
//   - If it does NOT (overlay only): innerH and clientH stay full, only vvH
//     shrinks — meaning the frame never resized, so --app-height:100% never
//     changes, the shell stays full height, and the input sits below the
//     keyboard. That's the "below then jump" symptom.
//
// Remove this component + its mount in ChatShell once diagnosed.

import { useEffect, useState } from "react";
import { isNative } from "@/lib/native";
import { getKeyboardSetupStatus } from "@/lib/native/keyboard";

interface Metrics {
  innerH: number;
  clientH: number;
  vvH: number;
  vvTop: number;
  appHeightVar: string;
  shellH: number;
  kbOpen: boolean;
  kbHeight: number;
  setup: string;
}

export default function NativeKeyboardDebug() {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    if (!isNative()) return;

    let kbOpen = false;
    let kbHeight = 0;

    const read = () => {
      const vv = window.visualViewport;
      const shell = document.querySelector(
        "[data-app-shell]"
      ) as HTMLElement | null;
      setM({
        innerH: Math.round(window.innerHeight),
        clientH: Math.round(document.documentElement.clientHeight),
        vvH: vv ? Math.round(vv.height) : -1,
        vvTop: vv ? Math.round(vv.offsetTop) : -1,
        appHeightVar:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--app-height")
            .trim() || "(unset)",
        shellH: shell ? Math.round(shell.getBoundingClientRect().height) : -1,
        kbOpen,
        kbHeight,
        setup: getKeyboardSetupStatus(),
      });
    };

    read();
    const interval = setInterval(read, 150);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", read);
    vv?.addEventListener("scroll", read);
    window.addEventListener("resize", read);

    let removeKbd: (() => void) | undefined;
    import("@capacitor/keyboard")
      .then(({ Keyboard }) => {
        const show = Keyboard.addListener("keyboardWillShow", (info) => {
          kbOpen = true;
          kbHeight = Math.round(info.keyboardHeight);
          read();
        });
        const hide = Keyboard.addListener("keyboardWillHide", () => {
          kbOpen = false;
          kbHeight = 0;
          read();
        });
        removeKbd = () => {
          show.then((h) => h.remove());
          hide.then((h) => h.remove());
        };
      })
      .catch(() => {});

    return () => {
      clearInterval(interval);
      vv?.removeEventListener("resize", read);
      vv?.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
      removeKbd?.();
    };
  }, []);

  if (!m) return null;

  return (
    <pre style={panel}>
      {`kb=${m.kbOpen ? "OPEN" : "closed"} kbH=${m.kbHeight}
innerH=${m.innerH}
clientH=${m.clientH}
vvH=${m.vvH} vvTop=${m.vvTop}
--app-height=${m.appHeightVar}
shellH=${m.shellH}
setup=${m.setup}`}
    </pre>
  );
}

const panel: React.CSSProperties = {
  position: "fixed",
  top: "calc(env(safe-area-inset-top, 0px) + 4px)",
  left: "4px",
  zIndex: 99999,
  margin: 0,
  padding: "6px 8px",
  background: "rgba(0,0,0,0.8)",
  color: "#0f6",
  font: "10px/1.35 ui-monospace, Menlo, monospace",
  borderRadius: "6px",
  pointerEvents: "none",
  whiteSpace: "pre",
};
