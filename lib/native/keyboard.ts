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

/** TEMP DIAGNOSTIC: last setupKeyboard() result, surfaced in NativeKeyboardDebug. */
export function getKeyboardSetupStatus(): string {
  if (typeof window === "undefined") return "(ssr)";
  return (window as Window & { __kbdSetup?: string }).__kbdSetup ?? "(pending)";
}

/** Configure the native keyboard on app launch. Best-effort — never throws. */
export async function setupKeyboard(): Promise<void> {
  if (!isNative()) return;
  const w = window as Window & { __kbdSetup?: string };
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    // Remove the ^ / v / Done accessory bar above the keyboard.
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
    // Let iOS resize the webview above the keyboard (replaces the visual-viewport
    // hack). The fixed shell returns to its CSS fallbacks (100dvh / top 0).
    await Keyboard.setResizeMode({ mode: KeyboardResize.Native });
    w.__kbdSetup = `OK accessoryBar=off resize=${KeyboardResize.Native}`;
    // eslint-disable-next-line no-console
    console.log("[native-kbd]", w.__kbdSetup); // TEMP DIAGNOSTIC
  } catch (e) {
    w.__kbdSetup = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
    // eslint-disable-next-line no-console
    console.log("[native-kbd]", w.__kbdSetup); // TEMP DIAGNOSTIC
  }
}
