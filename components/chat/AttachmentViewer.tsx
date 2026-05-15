"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ViewerContent =
  | { type: "pasted_text"; content: string; wordCount: number; lineCount: number; title: string }
  | { type: "image"; url: string; title: string }
  | { type: "document"; url: string; title: string };

interface AttachmentViewerProps {
  content: ViewerContent | null;
  onClose: () => void;
}

export default function AttachmentViewer({ content, onClose }: AttachmentViewerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!content) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [content, onClose]);

  if (!content || typeof window === "undefined") return null;

  return createPortal(
    <div
      style={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-modal="true"
      role="dialog"
      aria-label={content.title}
    >
      <div ref={panelRef} style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.headerTitle}>{content.title}</span>
          <button onClick={onClose} style={styles.closeBtn} aria-label="Close" type="button">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={styles.body}>
          {content.type === "pasted_text" && (
            <>
              <div style={styles.pastedMeta}>
                {content.wordCount} words · {content.lineCount} lines
              </div>
              <pre style={styles.pastedText}>{content.content}</pre>
            </>
          )}

          {content.type === "image" && (
            <div style={styles.imageWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={content.url}
                alt={content.title}
                style={styles.image}
              />
            </div>
          )}

          {content.type === "document" && (
            <div style={styles.docWrap}>
              <svg width="40" height="40" viewBox="0 0 16 16" fill="none" style={{ color: "var(--text-tertiary)" }}>
                <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <p style={styles.docName}>{content.title}</p>
              <a
                href={content.url}
                download={content.title}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.downloadBtn}
              >
                Download
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 9000,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
  },
  panel: {
    backgroundColor: "var(--bg-primary)",
    borderRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-lg)",
    width: "100%",
    maxWidth: "600px",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
  },
  closeBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "var(--radius-sm)",
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    flexShrink: 0,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
  },
  pastedMeta: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    marginBottom: "12px",
    flexShrink: 0,
  },
  pastedText: {
    flex: 1,
    fontSize: "0.875rem",
    lineHeight: "1.6",
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
    fontFamily: "inherit",
  },
  imageWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    touchAction: "pinch-zoom",
  },
  image: {
    maxWidth: "100%",
    maxHeight: "60vh",
    objectFit: "contain",
    borderRadius: "var(--radius-md)",
    display: "block",
  },
  docWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    flex: 1,
    padding: "24px",
  },
  docName: {
    fontSize: "0.9375rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    textAlign: "center",
    wordBreak: "break-word",
    margin: 0,
  },
  downloadBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "10px 20px",
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--accent)",
    color: "#ffffff",
    fontSize: "0.9375rem",
    fontWeight: "500",
    textDecoration: "none",
  },
};
