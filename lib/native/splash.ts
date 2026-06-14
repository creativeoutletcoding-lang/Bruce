/**
 * Native splash screen — native iOS shell.
 *
 * The splash is configured in capacitor.config.ts (dark background matching
 * --bg-primary, short launchShowDuration, launchAutoHide). We also hide it
 * explicitly once the app shell has mounted so there is no white flash between
 * the splash and the remote content painting.
 *
 * No-op outside the native shell. Plugin dynamically imported (SSR-safe).
 */
import { isNative } from "./index";

/** Hide the launch splash once content is ready. Best-effort — never throws. */
export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* plugin unavailable (e.g. web) */
  }
}
