"use client";

import { useRef, useEffect } from "react";
import { lightHaptic } from "@/lib/utils/haptics";

export interface ImageAttachment {
  base64: string;
  mediaType: string;
  previewUrl: string;
}

interface MessageInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  attachedImage?: ImageAttachment | null;
  onImageAttach?: (img: ImageAttachment) => void;
  onImageClear?: () => void;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Message Bruce",
  attachedImage,
  onImageAttach,
  onImageClear,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onResize() {
      const offset = window.innerHeight - (vv?.height ?? window.innerHeight);
      document.documentElement.style.setProperty("--keyboard-offset", `${offset}px`);
    }
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      if (!disabled && (value.trim() || attachedImage)) { lightHaptic(); onSend(); }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onImageAttach) return;
    e.target.value = "";
    const previewUrl = URL.createObjectURL(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      const mediaType = file.type || "image/jpeg";
      onImageAttach({ base64, mediaType, previewUrl });
    };
    reader.readAsDataURL(file);
  }

  const canSend = !disabled && (value.trim().length > 0 || !!attachedImage);

  return (
    <div style={styles.container}>
      {attachedImage && (
        <div style={styles.thumbnailRow}>
          <div style={styles.thumbnailWrapper}>
            <img src={attachedImage.previewUrl} alt="" style={styles.thumbnail} />
            <button onClick={onImageClear} style={styles.thumbnailClose} aria-label="Remove image">×</button>
          </div>
        </div>
      )}
      <div style={styles.inputRow}>
        {onImageAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={styles.attachButton}
              aria-label="Attach image"
              type="button"
              disabled={disabled}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M15 9.5l-5.5 5.5a4 4 0 0 1-5.657-5.657l6-6a2.5 2.5 0 0 1 3.535 3.535L7.5 12.5a1 1 0 0 1-1.414-1.414L11.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
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
          style={{ ...styles.sendButton, ...(!canSend ? styles.sendButtonDisabled : {}) }}
          aria-label="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 12V4M4 8l4-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
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
  thumbnailRow: {
    padding: "0 14px 8px",
    maxWidth: 780,
    margin: "0 auto",
    width: "100%",
  },
  thumbnailWrapper: {
    position: "relative",
    display: "inline-block",
  },
  thumbnail: {
    maxWidth: "80px",
    maxHeight: "80px",
    borderRadius: "var(--radius-md)",
    objectFit: "cover",
    display: "block",
  },
  thumbnailClose: {
    position: "absolute",
    top: "-6px",
    right: "-6px",
    width: "18px",
    height: "18px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--text-secondary)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.875rem",
    cursor: "pointer",
    lineHeight: "1",
    fontWeight: "600",
    border: "none",
  },
  inputRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: "8px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    padding: "8px 8px 8px 8px",
    transition: "border-color var(--transition)",
    width: "100%",
    maxWidth: 780,
    margin: "0 auto",
  },
  attachButton: {
    flexShrink: 0,
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    transition: "color var(--transition)",
    border: "none",
    background: "transparent",
    padding: 0,
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
    padding: "4px 0",
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
