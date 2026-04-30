"use client";

import { useRef, useEffect } from "react";
import { lightHaptic } from "@/lib/utils/haptics";

interface MessageInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Message Bruce",
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  // Handle iOS visualViewport keyboard offset
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function onResize() {
      const offset = window.innerHeight - (vv?.height ?? window.innerHeight);
      document.documentElement.style.setProperty(
        "--keyboard-offset",
        `${offset}px`
      );
    }

    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Desktop: Enter to send, Shift+Enter for newline
    // Mobile: Enter adds newline (no hardware keyboard detection, so check pointer)
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      if (!disabled && value.trim()) { lightHaptic(); onSend(); }
    }
  }

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div style={styles.container}>
      <div style={styles.inputRow}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          style={styles.textarea}
          aria-label="Message input"
        />
        <button
          onClick={() => { if (canSend) { lightHaptic(); onSend(); } }}
          disabled={!canSend}
          style={{
            ...styles.sendButton,
            ...(!canSend ? styles.sendButtonDisabled : {}),
          }}
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 12V4M4 8l4-4 4 4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "12px 12px calc(12px + var(--keyboard-offset, 0px) + env(safe-area-inset-bottom, 0px))",
    borderTop: "1px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    flexShrink: 0,
  },
  inputRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    padding: "8px 8px 8px 14px",
    transition: "border-color var(--transition)",
    width: "100%",
    maxWidth: 780,
    margin: "0 auto",
  },
  textarea: {
    flex: 1,
    border: "none",
    background: "transparent",
    color: "var(--text-primary)",
    fontSize: "0.9375rem",
    lineHeight: "1.5",
    resize: "none",
    outline: "none",
    minHeight: "24px",
    maxHeight: "120px",
    overflowY: "auto",
    padding: "0",
    caretColor: "var(--accent)",
  },
  sendButton: {
    flexShrink: 0,
    width: "32px",
    height: "32px",
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--accent)",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "opacity var(--transition), background-color var(--transition)",
    border: "none",
  },
  sendButtonDisabled: {
    backgroundColor: "var(--border-strong)",
    cursor: "not-allowed",
  },
};
