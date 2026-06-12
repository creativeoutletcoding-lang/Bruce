import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor native-shell config — OAuth spike (branch: spike/oauth-native).
 *
 * The shell is a thin iOS WKWebView pointed at LIVE Bruce. There is no local
 * web build: `server.url` loads heybruce.app directly.
 *
 * SPIKE VERIFICATION NOTE: the native OAuth guards added in this branch only
 * run if the loaded site CONTAINS this branch's code. Production heybruce.app
 * does NOT (this branch is never merged/deployed to prod). To verify on device,
 * temporarily point `server.url` at this branch's Vercel PREVIEW URL (an
 * automatic, production-untouching deploy created when the branch is pushed),
 * or at a local `next start` over your LAN IP. See docs/oauth-spike.md.
 */
const config: CapacitorConfig = {
  appId: "app.heybruce.shell",
  appName: "Bruce",
  webDir: "public",
  server: {
    url: "https://heybruce.app",
    cleartext: false,
  },
  ios: {
    contentInset: "never",
  },
};

export default config;
