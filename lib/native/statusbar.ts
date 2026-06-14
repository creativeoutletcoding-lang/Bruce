/**
 * Native status bar setup — native iOS shell.
 *
 * The shell renders edge-to-edge and the app header is already offset below the
 * status bar via env(safe-area-inset-top) (see ChatShell <main> + app/layout.tsx
 * viewport-fit=cover). So we overlay the status bar on the webview rather than
 * reserving extra space for it — the existing inset already accounts for it
 * (do NOT double-apply insets).
 *
 * Style follows the OS color scheme, which is how Bruce themes (globals.css uses
 * @media (prefers-color-scheme: dark) — no JS toggle): dark theme = dark header,
 * so the bar needs light text (Style.Dark); light theme = light header, dark
 * text (Style.Light). Keeping it in sync avoids invisible time/battery in either
 * theme.
 *
 * No-op outside the native shell. Plugin dynamically imported (SSR-safe).
 */
import { isNative } from "./index";

/** Configure the status bar on app launch. Best-effort — never throws. */
export async function setupStatusBar(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");

    // Sit over the already-inset header — the safe-area padding reserves the room.
    await StatusBar.setOverlaysWebView({ overlay: true });

    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    // Style.Dark = light text (for dark backgrounds); Style.Light = dark text.
    await StatusBar.setStyle({ style: prefersDark ? Style.Dark : Style.Light });

    // Keep the bar readable if the user flips the system appearance mid-session.
    window
      .matchMedia?.("(prefers-color-scheme: dark)")
      .addEventListener?.("change", (e) => {
        StatusBar.setStyle({ style: e.matches ? Style.Dark : Style.Light }).catch(
          () => {}
        );
      });
  } catch {
    /* plugin unavailable (e.g. web) */
  }
}
