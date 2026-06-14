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
      // Short, clean launch on a dark background matching the dark-theme
      // --bg-primary (#111111). hideSplash() also fires once the shell mounts.
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: "#111111",
      showSpinner: false,
    },
  },
};

export default config;
