import type { CapacitorConfig } from "@capacitor/cli";

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
    // The webview itself never scrolls — every chat surface scrolls internally
    // and the shell is position:fixed. Disabling it kills the document-level
    // rubber-band/bounce so it can't fight the chat scroll. (Layout/config only.)
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      // Dark background matching the dark-theme --bg-primary (#111111), so the
      // OS LaunchScreen → Capacitor splash → content sequence is all dark — no
      // white, no black gap. We hide the splash from NativeSplashGate the moment
      // the page paints (not on a timer), which is what removes the black gap
      // (the old 600ms auto-hide fired before the remote page had painted).
      // launchAutoHide stays true purely as a safety net (a long duration) in
      // case the gate never runs — e.g. the remote load errors before React
      // mounts — so the splash can't get stuck.
      launchShowDuration: 4000,
      launchAutoHide: true,
      backgroundColor: "#111111",
      launchFadeOutDuration: 200,
      showSpinner: false,
    },
  },
};

export default config;
