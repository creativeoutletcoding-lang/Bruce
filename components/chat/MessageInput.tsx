"use client";

import { useRef, useEffect, useState } from "react";
import { lightHaptic } from "@/lib/utils/haptics";

export interface FileAttachment {
  type: "image" | "document";
  base64: string;
  mediaType: string;
  filename: string;
  fileSize: number;
  previewUrl?: string;
}

export type ImageAttachment = FileAttachment;

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeDocMimeType(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "md") return "text/markdown";
  if (ext === "csv") return "text/plain";
  if (file.type) return file.type;
  return "text/plain";
}

interface MessageInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  attachedFile?: FileAttachment | null;
  onFileAttach?: (file: FileAttachment) => void;
  onFileClear?: () => void;
  attachedImage?: FileAttachment | null;
  onImageAttach?: (img: FileAttachment) => void;
  onImageClear?: () => void;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Message Bruce",
  attachedFile: attachedFileProp,
  onFileAttach: onFileAttachProp,
  onFileClear: onFileClearProp,
  attachedImage,
  onImageAttach,
  onImageClear,
}: MessageInputProps) {
  const attachment = attachedFileProp ?? attachedImage ?? null;
  const onAttach = onFileAttachProp ?? onImageAttach;
  const onClear = onFileClearProp ?? onImageClear;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

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
      if (!disabled && (value.trim() || attachment)) { lightHaptic(); onSend(); }
    }
  }

  function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onAttach) return;
    e.target.value = "";

    const ext = file.name.split(".").pop()?.toLowerCase();
    const isHeic = file.type === "image/heic" || file.type === "image/heif" || ext === "heic" || ext === "heif";
    if (isHeic) {
      setAttachmentError("Please use JPEG or PNG — HEIC format is not supported.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setAttachmentError("File too large — maximum 10MB");
      return;
    }

    setAttachmentError(null);
    const previewUrl = URL.createObjectURL(file);
    const mediaType = file.type || "image/jpeg";

    console.log("[MessageInput] file selected: mediaType=%s size=%d", mediaType, file.size);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      console.log("[MessageInput] FileReader done: base64Length=%d", base64?.length ?? 0);
      onAttach({
        type: "image",
        base64,
        mediaType,
        filename: file.name,
        fileSize: file.size,
        previewUrl,
      });
    };
    reader.onerror = async () => {
      // Fallback for iOS Safari FileReader quirks
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        console.log("[MessageInput] arrayBuffer fallback: base64Length=%d", base64.length);
        onAttach({
          type: "image",
          base64,
          mediaType,
          filename: file.name,
          fileSize: file.size,
          previewUrl,
        });
      } catch {
        setAttachmentError("Could not read file. Please try again.");
      }
    };
    reader.readAsDataURL(file);
  }

  function handleDocFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onAttach) return;
    e.target.value = "";
    if (file.size > MAX_FILE_SIZE) {
      setAttachmentError("File too large — maximum 10MB");
      return;
    }
    setAttachmentError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      onAttach({
        type: "document",
        base64,
        mediaType: normalizeDocMimeType(file),
        filename: file.name,
        fileSize: file.size,
      });
    };
    reader.readAsDataURL(file);
  }

  const canSend = !disabled && (value.trim().length > 0 || !!attachment);

  return (
    <div className="msg-input-container" style={styles.container}>
      {attachmentError && (
        <p style={styles.attachError}>{attachmentError}</p>
      )}
      {attachment && (
        <div style={styles.thumbnailRow}>
          {attachment.type === "image" && attachment.previewUrl ? (
            <div style={styles.thumbnailWrapper}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachment.previewUrl} alt="" style={styles.thumbnail} />
              <button onClick={onClear} style={styles.thumbnailClose} aria-label="Remove image">×</button>
            </div>
          ) : (
            <div style={styles.docChip}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--text-secondary)" }}>
                <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span style={styles.docChipName}>{attachment.filename}</span>
              <span style={styles.docChipSize}>{formatFileSize(attachment.fileSize)}</span>
              <button onClick={onClear} style={styles.thumbnailClose} aria-label="Remove file">×</button>
            </div>
          )}
        </div>
      )}
      <div className="msg-input-row" style={styles.inputRow}>
        {onAttach && (
          <div style={{ position: "relative", flexShrink: 0 }}>
            {showAttachMenu && (
              <>
                <div onClick={() => setShowAttachMenu(false)} style={styles.attachBackdrop} />
                <div style={styles.attachMenu}>
                  <button
                    type="button"
                    style={styles.attachOption}
                    onClick={() => { setShowAttachMenu(false); imageInputRef.current?.click(); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
                      <circle cx="5.5" cy="7.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M1 11l4-3.5 3 2.5 3-3 3 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Photo
                  </button>
                  <button
                    type="button"
                    style={styles.attachOption}
                    onClick={() => { setShowAttachMenu(false); docInputRef.current?.click(); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                      <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    Document
                  </button>
                </div>
              </>
            )}
            <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageFileChange} />
            <input ref={docInputRef} type="file" accept=".pdf,.txt,.md,.csv" style={{ display: "none" }} onChange={handleDocFileChange} />
            <button
              onClick={() => setShowAttachMenu((v) => !v)}
              style={styles.attachButton}
              aria-label="Attach file"
              type="button"
              disabled={disabled}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M15 9.5l-5.5 5.5a4 4 0 0 1-5.657-5.657l6-6a2.5 2.5 0 0 1 3.535 3.535L7.5 12.5a1 1 0 0 1-1.414-1.414L11.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
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
  attachError: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    padding: "0 14px 4px",
    margin: 0,
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
  docChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
    backgroundColor: "var(--bg-secondary)",
    maxWidth: "260px",
    position: "relative",
  },
  docChipName: {
    fontSize: "0.8125rem",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "140px",
  },
  docChipSize: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    flexShrink: 0,
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
  attachBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 97,
  },
  attachMenu: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    left: 0,
    zIndex: 98,
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    padding: "4px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: "140px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
  },
  attachOption: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    cursor: "pointer",
    border: "none",
    background: "transparent",
    textAlign: "left",
    transition: "background-color var(--transition)",
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
