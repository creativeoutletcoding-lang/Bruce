"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface BrowserPanelProps {
  chatId: string;
  sessionId: string;
  liveViewUrl: string;
  initialUrl?: string;
  onClose: () => void;
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

export default function BrowserPanel({
  chatId,
  sessionId,
  liveViewUrl,
  initialUrl,
  onClose,
}: BrowserPanelProps) {
  const [loading, setLoading] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const [urlBarValue, setUrlBarValue] = useState(initialUrl ?? "");
  const [navigating, setNavigating] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const urlBarRef = useRef(urlBarValue);
  const isDesktop = useIsDesktop();
  urlBarRef.current = urlBarValue;

  // Escape exits fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // Connection state from the Live View iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data === "browserbase-disconnected") setDisconnected(true);
      if (e.data === "browserbase-connected") setDisconnected(false);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Realtime URL sync — any member's navigation (or Bruce's) updates
  // browser_sessions.current_url; reflect it in the address bar unless
  // the user is mid-edit on the same value.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`browser-session-${chatId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "browser_sessions",
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          const newUrl = (payload.new as { current_url?: string }).current_url;
          if (newUrl && newUrl !== "about:blank" && newUrl !== urlBarRef.current) {
            setUrlBarValue(newUrl);
            setNavigating(false);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId]);

  async function handleNavigate(raw: string) {
    const value = raw.trim();
    if (!value) return;
    const normalized = value.startsWith("http") ? value : `https://${value}`;
    setNavigating(true);
    try {
      await fetch("/api/browser/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, action: "navigate", url: normalized }),
      });
      // Realtime UPDATE will reconcile urlBarValue to the resolved URL.
    } catch {
      setNavigating(false);
    }
  }

  function reloadIframe() {
    setLoading(true);
    setIframeKey((k) => k + 1);
  }

  const viewportHeight = isFullscreen ? undefined : isDesktop ? "460px" : "340px";

  const cardStyle: React.CSSProperties = isFullscreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-fullscreen)" as unknown as number,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "var(--bg-secondary)",
      }
    : styles.card;

  const viewportStyle: React.CSSProperties = isFullscreen
    ? { position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }
    : { position: "relative", height: viewportHeight, flexShrink: 0 };

  return (
    <div style={cardStyle}>
      <div style={styles.topBar}>
        <button
          onClick={reloadIframe}
          className="icon-btn" style={styles.iconButton}
          aria-label="Reload browser"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5V5h-2.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <input
          value={urlBarValue}
          onChange={(e) => setUrlBarValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleNavigate(urlBarValue);
            }
          }}
          placeholder="Enter a URL"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={styles.urlBar}
          aria-label="Browser address bar"
        />

        <button
          onClick={() => {
            if (urlBarValue) window.open(urlBarValue, "_blank", "noopener,noreferrer");
          }}
          className="icon-btn" style={styles.iconButton}
          aria-label="Open in a new browser tab"
          type="button"
          disabled={!urlBarValue}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V10M9.5 2.5H13.5V6.5M13 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          onClick={() => setIsFullscreen((f) => !f)}
          className="icon-btn" style={styles.iconButton}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          type="button"
        >
          {isFullscreen ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M5.5 2.5v3H2.5M10.5 2.5H13.5V5.5M13.5 10.5v3H10.5M5.5 13.5H2.5V10.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M2.5 5.5V2.5H5.5M13.5 2.5v3H10.5M13.5 10.5V13.5H10.5M2.5 10.5V13.5H5.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <button
          onClick={onClose}
          className="icon-btn" style={styles.iconButton}
          aria-label="Close browser panel"
          type="button"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div style={viewportStyle}>
        <iframe
          key={`${sessionId}-${iframeKey}`}
          src={liveViewUrl}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          allow="clipboard-read; clipboard-write"
          style={styles.iframe}
          onLoad={() => setLoading(false)}
          title="Shared browser"
        />

        {loading && !disconnected && (
          <div style={styles.overlay}>
            <div style={styles.pulseDot} />
            <span style={styles.overlayText}>Connecting to browser…</span>
          </div>
        )}

        {navigating && !loading && !disconnected && (
          <div style={styles.navBar}>
            <div style={styles.navBarFill} />
          </div>
        )}

        {disconnected && (
          <div style={styles.overlay}>
            <span style={styles.overlayText}>Browser disconnected</span>
            <button onClick={onClose} className="hover-wash" style={styles.closeFallback} type="button">
              Close panel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    width: "100%",
    borderRadius: "12px",
    overflow: "hidden",
    border: "1px solid var(--border)",
    backgroundColor: "var(--bg-secondary)",
    margin: "8px 0",
    display: "flex",
    flexDirection: "column",
  },
  topBar: {
    height: "44px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0 12px",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    flexShrink: 0,
  },
  iconButton: {
    flexShrink: 0,
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    padding: 0,
    transition: "color var(--transition), background-color var(--transition)",
  },
  urlBar: {
    flex: 1,
    minWidth: 0,
    height: "34px",
    padding: "0 12px",
    fontSize: "0.8125rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-full)",
    outline: "none",
    caretColor: "var(--accent)",
    WebkitAppearance: "none",
  },
  iframe: {
    width: "100%",
    height: "100%",
    border: "none",
    display: "block",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    backgroundColor: "var(--bg-secondary)",
  },
  overlayText: {
    fontSize: "0.875rem",
    color: "var(--text-secondary)",
  },
  pulseDot: {
    width: "12px",
    height: "12px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--accent)",
    animation: "bruce-browser-pulse 1.1s ease-in-out infinite",
  },
  navBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "2px",
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  navBarFill: {
    height: "100%",
    width: "40%",
    backgroundColor: "var(--accent)",
    animation: "bruce-browser-indeterminate 1.1s ease-in-out infinite",
  },
  closeFallback: {
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: "#fff",
    backgroundColor: "var(--accent)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "8px 16px",
    cursor: "pointer",
  },
};
