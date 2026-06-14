/**
 * Native keyboard setup — native iOS shell.
 *
 *   - hide the iOS form-assistant accessory bar (the ^ / v / Done strip), and
 *   - drive the layout from the keyboard animation itself, so the input starts
 *     moving in the SAME instant the keyboard does (no start lag).
 *
 * Why KeyboardResize.None (not Native): with Native the OS resizes the webview
 * frame, but that resize + reflow lands a beat AFTER keyboardWillShow, so the
 * input shifted up late. With None the frame never resizes; instead we react to
 * keyboardWillShow — which fires at the START of the slide and reports
 * keyboardHeight — and shrink the shell ourselves, in lockstep with the
 * keyboard. We reuse the existing CSS vars so no other layout code changes:
 *   --app-height   → shell height. Setting it to (innerHeight - keyboardHeight)
 *                    shrinks the shell from the bottom: the bottom-pinned input
 *                    rises above the keyboard and the flex:1 message list
 *                    shrinks (its content stays above the keyboard). The
 *                    .kb-animating class transitions this change so it rides the
 *                    keyboard's ~250ms slide.
 *   --kb-safe-bottom → composer bottom padding. keyboardHeight already includes
 *                    the home-indicator safe area, so we zero it while the
 *                    keyboard is up to sit snug above it; restore env() on hide.
 * The message list's own visualViewport autoscroll keeps the latest message
 * visible (MessageList.tsx) — it fires on the keyboard-driven viewport shrink.
 *
 * No-op outside the native shell — callers guard with isNative(), and the
 * Capacitor plugin is dynamically imported so it never enters the web bundle's
 * SSR/module graph.
 */
import { isNative } from "./index";

// Keep the animation class slightly longer than the CSS transition (~250ms) so
// it always outlasts the keyboard slide.
const KB_ANIM_MS = 320;

function getShell(): (HTMLElement & { _kbTimer?: number }) | null {
  return document.querySelector("[data-app-shell]") as
    | (HTMLElement & { _kbTimer?: number })
    | null;
}

/** Add .kb-animating to the shell for the duration of the keyboard animation. */
function flagAnimating(): void {
  const shell = getShell();
  if (!shell) return;
  shell.classList.add("kb-animating");
  window.clearTimeout(shell._kbTimer);
  shell._kbTimer = window.setTimeout(() => {
    shell.classList.remove("kb-animating");
  }, KB_ANIM_MS);
}

function setVars(appHeight: string, kbSafeBottom: string): void {
  const root = document.documentElement;
  root.style.setProperty("--app-height", appHeight);
  root.style.setProperty("--kb-safe-bottom", kbSafeBottom);
}

/** Configure the native keyboard on app launch. Best-effort — never throws. */
export async function setupKeyboard(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    // Remove the ^ / v / Done accessory bar above the keyboard.
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    // Don't let the OS resize the frame — we drive the layout ourselves so the
    // input leads the keyboard from the first frame (see file header).
    await Keyboard.setResizeMode({ mode: KeyboardResize.None });

    Keyboard.addListener("keyboardWillShow", (info) => {
      flagAnimating();
      const h = Math.max(0, window.innerHeight - info.keyboardHeight);
      setVars(`${h}px`, "0px");
      // Under None mode the visualViewport resize doesn't fire reliably, so the
      // message list can't tell the keyboard covered the latest message. Tell it
      // to pin to the bottom (MessageList honours it only when already at bottom).
      window.dispatchEvent(new Event("bruce:keyboardshow"));
    });

    Keyboard.addListener("keyboardWillHide", () => {
      flagAnimating();
      setVars("100%", "env(safe-area-inset-bottom, 0px)");
    });
  } catch {
    /* plugin unavailable (e.g. web) — viewport hack / fallbacks cover it */
  }
}
