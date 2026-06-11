import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ACCENT_COLOR } from "@/lib/utils/constants";

export const metadata: Metadata = {
  title: "Bruce",
  description: "Johnson Household AI",
  manifest: "/manifest.json?v=3",
  icons: {
    apple: [{ url: "/apple-touch-icon.png?v=3", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bruce",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: ACCENT_COLOR,
  viewportFit: "cover",
  // Android Chrome: resize the page when the keyboard opens instead of
  // overlaying it. iOS ignores this — useVisualViewportLock covers it there.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
