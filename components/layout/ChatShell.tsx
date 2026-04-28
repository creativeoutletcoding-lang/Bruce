"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { User } from "@/lib/types";
import Sidebar from "./Sidebar";

interface ChatContextValue {
  openDrawer: () => void;
  incognito: boolean;
  setIncognito: (v: boolean) => void;
}

export const ChatContext = createContext<ChatContextValue>({
  openDrawer: () => {},
  incognito: false,
  setIncognito: () => {},
});

export function useChatContext() {
  return useContext(ChatContext);
}

interface ChatShellProps {
  user: User;
  children: React.ReactNode;
}

export default function ChatShell({ user, children }: ChatShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [incognito, setIncognito] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <ChatContext.Provider value={{ openDrawer, incognito, setIncognito }}>
      <div style={styles.shell}>
        {/* Desktop sidebar */}
        <div data-sidebar-desktop style={styles.sidebarDesktop}>
          <Sidebar user={user} onNavigate={closeDrawer} />
        </div>

        {/* Mobile overlay */}
        {drawerOpen && (
          <div
            style={styles.overlay}
            onClick={closeDrawer}
            aria-hidden="true"
          />
        )}

        {/* Mobile drawer */}
        <div
          style={{
            ...styles.sidebarMobile,
            transform: drawerOpen ? "translateX(0)" : "translateX(-100%)",
          }}
        >
          <Sidebar user={user} onNavigate={closeDrawer} />
        </div>

        {/* Main content */}
        <main style={styles.main}>{children}</main>
      </div>
    </ChatContext.Provider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    height: "100dvh",
    overflow: "hidden",
    backgroundColor: "var(--bg-primary)",
  },
  sidebarDesktop: {
    width: "var(--sidebar-width)",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--border)",
    backgroundColor: "var(--bg-sidebar)",
    // Hidden on mobile via media query in globals.css
  },
  sidebarMobile: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "var(--sidebar-width)",
    zIndex: 200,
    backgroundColor: "var(--bg-sidebar)",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    transition: "transform var(--transition)",
    // Always present in DOM for animation; visibility handled by transform
  },
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    zIndex: 199,
  },
  main: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
};
