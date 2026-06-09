"use client";

// Responsive layout wrapper shared by all three chat contexts. When the shared
// browser panel is open it splits the view: a 50/50 grid on desktop, and a
// full-screen overlay on mobile (chat stays mounted underneath). When closed it
// renders the chat alone. Keeping this in one place satisfies the CHAT UI RULE —
// the split layout is never forked into the individual wrappers.

import { useEffect, useState, type ReactNode } from "react";

interface BrowserSplitLayoutProps {
  panelOpen: boolean;
  /** The BrowserPanel element (already configured by the wrapper). */
  panel: ReactNode;
  children: ReactNode;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    setIsDesktop(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

export default function BrowserSplitLayout({ panelOpen, panel, children }: BrowserSplitLayoutProps) {
  const isDesktop = useIsDesktop();

  if (!panelOpen) {
    return <div style={styles.full}>{children}</div>;
  }

  if (isDesktop) {
    return (
      <div style={styles.grid}>
        <div style={styles.gridChat}>{children}</div>
        <div style={styles.gridPanel}>{panel}</div>
      </div>
    );
  }

  // Mobile — chat stays mounted underneath; panel is a fixed full-screen overlay.
  return (
    <div style={styles.full}>
      {children}
      <div style={styles.mobileOverlay}>{panel}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  full: {
    height: "100%",
    width: "100%",
    minHeight: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    height: "100%",
    width: "100%",
    overflow: "hidden",
  },
  gridChat: {
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  gridPanel: {
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  mobileOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    backgroundColor: "var(--bg-primary)",
  },
};
