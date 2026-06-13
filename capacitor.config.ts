import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.heybruce.shell",
  appName: "Bruce",
  webDir: "public",
  server: {
    url: "https://bruce-git-spike-oaut-44d5c1-creativeoutletcoding-4766s-projects.vercel.app",
    cleartext: false,
  },
  ios: { contentInset: "never" },
};

export default config;
