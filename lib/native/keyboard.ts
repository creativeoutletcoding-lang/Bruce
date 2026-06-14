/**
 * Native keyboard setup — native iOS shell.
 *
 *   - hide the iOS form-assistant accessory bar (the ^ / v / Done strip),
 *   - resize the webview natively above the keyboard (KeyboardResize.Native —
 *     confirmed on device: innerHeight/clientHeight/visualViewport all shrink
 *     together by the keyboard height, and the shell's --app-height:100% tracks
 *     the resized frame), and
 *   - smooth the transition: the native frame resize and the keyboard slide
 *     animate on slightly different ticks, so the content can appear to settle a
 *     beat late ("two-step"). We add a brief height transition on the shell ONLY
 *     during the keyboard's animation window (.kb-animating, toggled on
 *     keyboardWillShow/WillHide) so the shrink animates in sync with the slide.
 *     The native resize stays authoritative — no JS height calculation.
 *
 * No-op outside the native shell — callers guard with isNative(), and the
 * Capacitor plugin is dynamically imported so it never enters the web bundle's
 * SSR/module graph.
 */
import { isNative } from "./index";

// iOS keyboard slide is ~250ms; a small buffer lets the transition settle before
// we drop the class (so a later unrelated resize isn't animated).
const KB_ANIM_MS = 280;

/** Add .kb-animating to the shell for the duration of the keyboard animation. */
function flagKeyboardAnimating(): void {
  const shell = document.querySelector(
    "[data-app-shell]"
  ) as (HTMLElement & { _kbTimer?: number }) | null;
  if (!shell) return;
  shell.classList.add("kb-animating");
  window.clearTimeout(shell._kbTimer);
  shell._kbTimer = window.setTimeout(() => {
    shell.classList.remove("kb-animating");
  }, KB_ANIM_MS);
}

/** Configure the native keyboard on app launch. Best-effort — never throws. */
export async function setupKeyboard(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    // Remove the ^ / v / Done accessory bar above the keyboard.
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    // Let iOS resize the webview above the keyboard.
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    // Animate the shell's height change in sync with the keyboard slide.
    Keyboard.addListener("keyboardWillShow", flagKeyboardAnimating);
    Keyboard.addListener("keyboardWillHide", flagKeyboardAnimating);
  } catch {
    /* plugin unavailable (e.g. web) — viewport hack / fallbacks cover it */
  }
}
