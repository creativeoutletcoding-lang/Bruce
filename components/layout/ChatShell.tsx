"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { requestAndGetToken } from "@/lib/firebase/client";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "@/lib/types";
import Sidebar from "./Sidebar";

interface ChatContextValue {
  openDrawer: () => void;
  incognito: boolean;
  setIncognito: (v: boolean) => void;
  refreshChats: () => void;
  registerRefresh: (fn: () => void) => void;
}

export const ChatContext = createContext<ChatContextValue>({
  openDrawer: () => {},
  incognito: false,
  setIncognito: () => {},
  refreshChats: () => {},
  registerRefresh: () => {},
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
  const refreshCallbacks = useRef<Set<() => void>>(new Set());
  const pathname = usePathname();
  const router = useRouter();

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Bottom nav hides when the user is inside a specific private chat, project chat, or family thread
  const isInsideSpecificChat =
    /^\/chat\/[^/]+/.test(pathname) ||
    /\/projects\/[^/]+\/chat\//.test(pathname) ||
    /^\/family\/threads\/[^/]+/.test(pathname);
  const registerRefresh = useCallback((fn: () => void) => {
    refreshCallbacks.current.add(fn);
  }, []);
  const refreshChats = useCallback(() => {
    refreshCallbacks.current.forEach((fn) => fn());
  }, []);

  // Request notification permission and register FCM token once on mount.
  useEffect(() => {
    requestAndGetToken().then((token) => {
      if (!token) return;
      fetch("/api/notifications/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => {});
    });
  }, []);

  return (
    <ChatContext.Provider value={{ openDrawer, incognito, setIncognito, refreshChats, registerRefresh }}>
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
        <main
          style={styles.main}
          className={!isInsideSpecificChat ? "with-bottom-nav" : undefined}
        >
          {children}
        </main>

        {/* Mobile bottom nav — hidden on desktop via CSS, hidden inside chats */}
        {!isInsideSpecificChat && (
          <nav style={styles.bottomNav} aria-label="Main navigation">
            {/* Home */}
            <button
              style={{
                ...styles.navTab,
                ...(pathname === "/chat" ? styles.navTabActive : {}),
              }}
              onClick={() => router.push("/chat")}
              aria-label="New chat"
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path
                  d="M11 3C6.582 3 3 6.134 3 10c0 2 .9 3.8 2.35 5.08-.16 1.18-.75 2.35-1.8 3.03a6 6 0 0 0 4.27-1.47C8.5 16.85 9.72 17 11 17c4.418 0 8-3.134 8-7s-3.582-7-8-7Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  fill={pathname === "/chat" ? "currentColor" : "none"}
                />
              </svg>
              <span style={styles.navLabel}>Chats</span>
            </button>

            {/* Projects — opens sidebar */}
            <button
              style={{
                ...styles.navTab,
                ...(pathname.startsWith("/projects") ? styles.navTabActive : {}),
              }}
              onClick={() => openDrawer()}
              aria-label="Projects"
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <rect
                  x="3" y="6" width="16" height="13" rx="2"
                  stroke="currentColor" strokeWidth="1.6"
                  fill={pathname.startsWith("/projects") ? "currentColor" : "none"}
                  fillOpacity={pathname.startsWith("/projects") ? 0.15 : 0}
                />
                <path
                  d="M3 9h16M8 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                />
              </svg>
              <span style={styles.navLabel}>Projects</span>
            </button>

            {/* Family */}
            <button
              style={{
                ...styles.navTab,
                ...(pathname.startsWith("/family") ? styles.navTabActive : {}),
              }}
              onClick={() => router.push("/family")}
              aria-label="Family chat"
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path
                  d="M11 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 19a7 7 0 0 1 14 0"
                  stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                />
                <circle
                  cx="4.5" cy="9" r="2.5"
                  stroke="currentColor" strokeWidth="1.4"
                  fill={pathname.startsWith("/family") ? "currentColor" : "none"}
                  fillOpacity={pathname.startsWith("/family") ? 0.2 : 0}
                />
                <circle
                  cx="17.5" cy="9" r="2.5"
                  stroke="currentColor" strokeWidth="1.4"
                  fill={pathname.startsWith("/family") ? "currentColor" : "none"}
                  fillOpacity={pathname.startsWith("/family") ? 0.2 : 0}
                />
              </svg>
              <span style={styles.navLabel}>Family</span>
            </button>
          </nav>
        )}
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
  bottomNav: {
    display: "none", // shown only on mobile via media query applied via className in globals.css
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    height: "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px))",
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
    backgroundColor: "var(--bg-primary)",
    borderTop: "1px solid var(--border)",
    flexDirection: "row",
    alignItems: "stretch",
    zIndex: 100,
  },
  navTab: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "3px",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    transition: "color var(--transition)",
    fontSize: "0.625rem",
    fontWeight: "500",
    paddingBottom: "2px",
  },
  navTabActive: {
    color: "var(--accent)",
  },
  navLabel: {
    lineHeight: 1,
  },
};
