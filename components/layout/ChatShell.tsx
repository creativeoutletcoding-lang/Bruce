"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { requestAndGetToken, listenForegroundMessages } from "@/lib/firebase/client";
import type { User } from "@/lib/types";
import Sidebar from "./Sidebar";

interface ForegroundToast {
  title: string;
  body: string;
  url: string;
}

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
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [incognito, setIncognito] = useState(false);
  // isMounted gates the toast so it never renders during SSR or the initial
  // hydration pass. This prevents React #418: the server emits no toast HTML,
  // and the client fiber tree must match before any effects run.
  const [isMounted, setIsMounted] = useState(false);
  const [toast, setToast] = useState<ForegroundToast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshCallbacks = useRef<Set<() => void>>(new Set());
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const registerRefresh = useCallback((fn: () => void) => {
    refreshCallbacks.current.add(fn);
  }, []);
  const refreshChats = useCallback(() => {
    refreshCallbacks.current.forEach((fn) => fn());
  }, []);

  useEffect(() => { setIsMounted(true); }, []);

  // Request notification permission and register FCM token once on mount.
  useEffect(() => {
    const deviceHint = getDeviceHint();
    requestAndGetToken().then((token) => {
      if (!token) return;
      fetch("/api/notifications/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, deviceHint }),
      }).catch(() => {});
    });
  }, []);

  // On app open: clear badge immediately and mark all notifications as read.
  useEffect(() => {
    if ("clearAppBadge" in navigator) navigator.clearAppBadge().catch(() => {});
    fetch("/api/notifications/mark-read", { method: "POST" }).catch(() => {});
  }, []);

  // Foreground FCM messages — show in-app toast unless already viewing that chat.
  useEffect(() => {
    const unsub = listenForegroundMessages((payload) => {
      const title = payload.data?.title ?? "Bruce";
      const body = payload.data?.body ?? "";
      const url = payload.data?.url ?? "";

      if (url) {
        try {
          const targetPath = new URL(url).pathname;
          if (window.location.pathname === targetPath) return;
        } catch {}
      }

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({ title, body, url });
      toastTimerRef.current = setTimeout(() => setToast(null), 5000);
    });
    return () => {
      unsub();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  const handleToastClick = useCallback(() => {
    if (toast?.url) {
      try {
        router.push(new URL(toast.url).pathname);
      } catch {
        router.push(toast.url);
      }
    }
    dismissToast();
  }, [toast, router, dismissToast]);

  return (
    <ChatContext.Provider value={{ openDrawer, incognito, setIncognito, refreshChats, registerRefresh }}>
      {isMounted && toast && (
        <div role="alert" onClick={handleToastClick} style={styles.toast} className="bruce-toast">
          <div style={styles.toastContent}>
            <span style={styles.toastTitle}>{toast.title}</span>
            {toast.body && <span style={styles.toastBody}>{toast.body}</span>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); dismissToast(); }}
            style={styles.toastDismiss}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
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
        <main style={styles.main}>
          {children}
        </main>
      </div>
    </ChatContext.Provider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toast: {
    position: "fixed",
    top: "calc(env(safe-area-inset-top, 0px) + 12px)",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 9999,
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px 14px",
    maxWidth: "min(380px, calc(100vw - 32px))",
    width: "max-content",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderLeft: "3px solid var(--accent)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    cursor: "pointer",
  },
  toastContent: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  toastTitle: {
    fontSize: "0.875rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  toastBody: {
    fontSize: "0.8125rem",
    color: "var(--text-secondary)",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  toastDismiss: {
    flexShrink: 0,
    background: "none",
    border: "none",
    color: "var(--text-tertiary)",
    fontSize: "1.125rem",
    lineHeight: 1,
    cursor: "pointer",
    padding: "0 2px",
    marginTop: "-2px",
  },
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

function getDeviceHint(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Browser";
}
