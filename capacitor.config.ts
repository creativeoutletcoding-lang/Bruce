import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.heybruce.shell",
  appName: "Bruce",
  webDir: "public",
  server: {
    url: "https://heybruce.app",
    cleartext: false,
  },
  ios: { contentInset: "never" },
};

export default config;
