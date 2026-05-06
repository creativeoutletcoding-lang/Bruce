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

// Legacy alias kept so callers that import ImageAttachment still compile
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

function processFile(file: File): Promise<FileAttachment | null> {
  const isImage = file.type.startsWith("image/");
  const type: "image" | "document" = isImage ? "image" : "document";
  const mediaType = isImage ? file.type || "image/jpeg" : normalizeDocMimeType(file);
  const previewUrl = isImage ? URL.createObjectURL(file) : undefined;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      resolve({ type, base64, mediaType, filename: file.name, fileSize: file.size, previewUrl });
    };
    reader.onerror = async () => {
      if (!isImage) { resolve(null); return; }
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        resolve({ type, base64, mediaType, filename: file.name, fileSize: file.size, previewUrl });
      } catch {
        resolve(null);
      }
    };
    reader.readAsDataURL(file);
  });
}

interface MessageInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  attachedFiles?: FileAttachment[];
  onFilesAttach?: (files: FileAttachment[]) => void;
  onFileRemove?: (index: number) => void;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder = "Message Bruce",
  attachedFiles = [],
  onFilesAttach,
  onFileRemove,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);

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
      if (!disabled && (value.trim() || attachedFiles.length > 0)) { lightHaptic(); onSend(); }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length || !onFilesAttach) return;

    const errors: string[] = [];
    const validFiles: File[] = [];

    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const isHeic = file.type === "image/heic" || file.type === "image/heif" || ext === "heic" || ext === "heif";
      if (isHeic) {
        errors.push(`${file.name}: HEIC not supported — use JPEG or PNG`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: File too large (max 10MB)`);
        continue;
      }
      validFiles.push(file);
    }

    setAttachmentErrors(errors);
    if (validFiles.length === 0) return;

    const results = await Promise.all(validFiles.map(processFile));
    const attachments = results.filter((r): r is FileAttachment => r !== null);
    if (attachments.length > 0) onFilesAttach(attachments);
  }

  const canSend = !disabled && (value.trim().length > 0 || attachedFiles.length > 0);

  return (
    <div className="msg-input-container" style={styles.container}>
      {attachmentErrors.length > 0 && (
        <div style={styles.errorsBlock}>
          {attachmentErrors.map((err, i) => (
            <p key={i} style={styles.attachError}>{err}</p>
          ))}
        </div>
      )}

      {attachedFiles.length > 0 && (
        <div style={styles.attachmentsRow}>
          {attachedFiles.map((file, i) => (
            <div key={i} style={{ flexShrink: 0 }}>
              {file.type === "image" && file.previewUrl ? (
                <div style={styles.thumbnailWrapper}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file.previewUrl} alt="" style={styles.thumbnail} />
                  <button onClick={() => onFileRemove?.(i)} style={styles.thumbnailClose} aria-label="Remove image">×</button>
                </div>
              ) : (
                <div style={styles.docChip}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--text-secondary)" }}>
                    <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span style={styles.docChipName}>{file.filename}</span>
                  <span style={styles.docChipSize}>{formatFileSize(file.fileSize)}</span>
                  <button onClick={() => onFileRemove?.(i)} style={styles.thumbnailClose} aria-label="Remove file">×</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="msg-input-row" style={styles.inputRow}>
        {onFilesAttach && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.csv,image/*"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={styles.attachButton}
              aria-label="Attach file"
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
  errorsBlock: {
    padding: "0 14px 4px",
    maxWidth: 780,
    margin: "0 auto",
    width: "100%",
  },
  attachError: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    margin: "0 0 2px",
  },
  attachmentsRow: {
    display: "flex",
    gap: "8px",
    padding: "0 14px 8px",
    maxWidth: 780,
    margin: "0 auto",
    width: "100%",
    overflowX: "auto",
    WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
  },
  thumbnailWrapper: {
    position: "relative",
    display: "inline-block",
  },
  thumbnail: {
    width: "48px",
    height: "48px",
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
    maxWidth: "200px",
    position: "relative",
  },
  docChipName: {
    fontSize: "0.8125rem",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100px",
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
