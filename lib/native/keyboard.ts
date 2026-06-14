/**
 * Native keyboard setup — native iOS shell.
 *
 * Replaces the iOS PWA viewport hack (hooks/useVisualViewportLock.ts) with the
 * OS-level behaviour:
 *   - hide the iOS form-assistant accessory bar (the ^ / v / Done strip), and
 *   - resize the webview natively above the keyboard, so the conversation stays
 *     visible without JS visual-viewport tracking.
 *
 * No-op outside the native shell — callers guard with isNative(), and the
 * Capacitor plugin is dynamically imported so it never enters the web bundle's
 * SSR/module graph.
 */
import { isNative } from "./index";

/** Configure the native keyboard on app launch. Best-effort — never throws. */
export async function setupKeyboard(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    // Remove the ^ / v / Done accessory bar above the keyboard.
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    // Let iOS resize the webview above the keyboard (replaces the visual-viewport
    // hack). The fixed shell returns to its CSS fallbacks (100dvh / top 0).
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
  } catch {
    /* plugin unavailable (e.g. web) — viewport hack / fallbacks cover it */
  }
}
