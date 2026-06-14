"use client";

import { useRef, useEffect, useState, type ReactNode } from "react";
import { lightHaptic } from "@/lib/utils/haptics";
import InputPlusMenu, { type MoveToProjectConfig } from "./InputPlusMenu";

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

interface PastedAttachment {
  id: string;
  filename: string;
  content: string;
  wordCount: number;
  lineCount: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const PASTE_THRESHOLD = 1500;

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

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const EXT_MEDIA_TYPE: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", bmp: "image/jpeg",
};

// Resize image to max 1568px on the longest side before upload.
// Anthropic vision models are optimized at this resolution; larger images
// waste tokens without improving quality.
function resizeImage(base64: string, mediaType: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1568;
      if (img.width <= MAX && img.height <= MAX) { resolve(base64); return; }
      const ratio = Math.min(MAX / img.width, MAX / img.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(base64); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const outType = mediaType === "image/png" ? "image/png" : "image/jpeg";
      const resized = canvas.toDataURL(outType, 0.85).split(",")[1];
      resolve(resized ?? base64);
    };
    img.onerror = () => resolve(base64);
    img.src = `data:${mediaType};base64,${base64}`;
  });
}

function processFile(file: File): Promise<FileAttachment | null> {
  // Mobile camera capture often delivers file.type as "" — fall back to extension
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const isImage = file.type.startsWith("image/") || IMAGE_EXTS.has(ext);
  const type: "image" | "document" = isImage ? "image" : "document";

  let mediaType: string;
  if (isImage) {
    mediaType = file.type.startsWith("image/") ? file.type : (EXT_MEDIA_TYPE[ext] ?? "image/jpeg");
  } else {
    mediaType = normalizeDocMimeType(file);
  }

  const previewUrl = isImage ? URL.createObjectURL(file) : undefined;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const rawBase64 = dataUrl?.split(",")[1];
      if (!rawBase64) { resolve(null); return; }
      const base64 = isImage ? await resizeImage(rawBase64, mediaType) : rawBase64;
      resolve({ type, base64, mediaType, filename: file.name, fileSize: file.size, previewUrl });
    };
    reader.onerror = async () => {
      if (!isImage) { resolve(null); return; }
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const rawBase64 = btoa(binary);
        const base64 = await resizeImage(rawBase64, mediaType);
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
  /** When true, the send button is replaced with a stop button. */
  isStreaming?: boolean;
  /** Called when the user presses the stop button while streaming. */
  onStop?: () => void;
  disabled?: boolean;
  placeholder?: string;
  attachedFiles?: FileAttachment[];
  onFilesAttach?: (files: FileAttachment[]) => void;
  onFileRemove?: (index: number) => void;
  containerStyle?: React.CSSProperties;
  modelPicker?: ReactNode;
  /** When set, the "+" menu shows a "Move to project" entry (standalone private chats). */
  moveToProject?: MoveToProjectConfig;
  /** Tap handler for the shared-browser globe button. When omitted (incognito), the button is hidden. */
  onBrowserClick?: () => void;
  /** True when a shared browser panel is currently open (highlights the globe). */
  browserActive?: boolean;
  /** True while a browser session is being created (spinner on the globe). */
  browserOpening?: boolean;
}

export default function MessageInput({
  value,
  onChange,
  onSend,
  isStreaming = false,
  onStop,
  disabled = false,
  placeholder = "Message Bruce",
  attachedFiles = [],
  onFilesAttach,
  onFileRemove,
  containerStyle,
  modelPicker,
  moveToProject,
  onBrowserClick,
  browserActive = false,
  browserOpening = false,
}: MessageInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentErrors, setAttachmentErrors] = useState<string[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [pastedAttachments, setPastedAttachments] = useState<PastedAttachment[]>([]);
  const pendingSendRef = useRef(false);
  const pendingContentRef = useRef("");

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
  }, [value]);

  // After parent re-renders with the prepended content, fire the real onSend.
  // This is needed because onSend closes over the parent's input state — we must
  // wait for the parent to have the updated value before calling it.
  useEffect(() => {
    if (pendingSendRef.current && value === pendingContentRef.current) {
      pendingSendRef.current = false;
      pendingContentRef.current = "";
      onSend();
    }
  }, [value, onSend]);


  const canSend = !disabled && !isStreaming && (
    value.trim().length > 0 || attachedFiles.length > 0 || pastedAttachments.length > 0
  );
  const canStop = isStreaming && Boolean(onStop);

  function triggerSend() {
    if (!canSend) return;
    lightHaptic();

    if (pastedAttachments.length > 0) {
      const blocks = pastedAttachments
        .map(a => `<attached_text filename="${a.filename}">\n${a.content}\n</attached_text>`)
        .join("\n\n");
      const separator = value.trim() ? "\n\n" : "";
      const fullContent = blocks + separator + value;
      pendingContentRef.current = fullContent;
      pendingSendRef.current = true;
      setPastedAttachments([]);
      onChange(fullContent);
      // onSend fires via useEffect once parent re-renders with fullContent
    } else {
      onSend();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      triggerSend();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (text.length <= PASTE_THRESHOLD) return;

    e.preventDefault();
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const lineCount = text.split("\n").length;
    setPastedAttachments(prev => [
      ...prev,
      { id: `paste-${Date.now()}`, filename: "pasted-text.txt", content: text, wordCount, lineCount },
    ]);
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

  return (
    <div className="msg-input-container" style={{ ...styles.container, ...containerStyle }}>
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
                  <button onClick={() => onFileRemove?.(i)} className="hit-target" style={styles.thumbnailClose} aria-label="Remove image">×</button>
                </div>
              ) : (
                <div style={styles.docChip}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--text-secondary)" }}>
                    <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                    <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span style={styles.docChipName}>{file.filename}</span>
                  <span style={styles.docChipSize}>{formatFileSize(file.fileSize)}</span>
                  <button onClick={() => onFileRemove?.(i)} className="hit-target" style={styles.thumbnailClose} aria-label="Remove file">×</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pastedAttachments.length > 0 && (
        <div style={styles.attachmentsRow}>
          {pastedAttachments.map((att) => (
            <div key={att.id} style={styles.pastedChip}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--text-secondary)" }}>
                <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <div style={styles.pastedChipText}>
                <span style={styles.pastedChipName}>Pasted text</span>
                <span style={styles.pastedChipMeta}>{att.wordCount} words · {att.lineCount} lines</span>
              </div>
              <button
                onClick={() => setPastedAttachments(prev => prev.filter(a => a.id !== att.id))}
                className="hit-target"
                style={styles.pastedChipClose}
                aria-label="Remove pasted text"
                type="button"
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* One rounded container, VERTICAL stack: text on top (full width, never
          wrapping around controls), control bar below. Matches the Claude iOS
          composer — the controls live in their own row, so the textarea behaves
          like a normal full-width field and long/multi-line text stays clean. */}
      <div
        className="msg-input-box"
        style={{ ...styles.box, ...(isFocused ? styles.boxFocused : {}) }}
      >
        {onFilesAttach && (
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.csv,image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        )}

        {/* Row 1 — the text field, full width, no inline buttons. */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          rows={1}
          style={styles.textarea}
          aria-label="Message input"
        />

        {/* Row 2 — control bar: + left; browser/model/send right. */}
        <div style={styles.controlRow}>
          <div style={styles.controlLeft}>
            {moveToProject ? (
              // "Move to project" is eligible → full "+" menu (attach + move).
              <InputPlusMenu
                onAttachFile={onFilesAttach ? () => fileInputRef.current?.click() : undefined}
                moveToProject={moveToProject}
                disabled={disabled}
              />
            ) : onFilesAttach ? (
              // No move option → keep attach a single tap (no menu).
              <button
                onClick={() => fileInputRef.current?.click()}
                className="icon-btn" style={styles.attachButton}
                aria-label="Attach file"
                type="button"
                disabled={disabled}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M15 9.5l-5.5 5.5a4 4 0 0 1-5.657-5.657l6-6a2.5 2.5 0 0 1 3.535 3.535L7.5 12.5a1 1 0 0 1-1.414-1.414L11.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : null}
          </div>

          <div style={styles.controlRight}>
            {onBrowserClick && (
              <button
                onClick={() => { lightHaptic(); onBrowserClick(); }}
                className="icon-btn" style={{ ...styles.browserButton, ...(browserActive ? styles.browserButtonActive : {}) }}
                aria-label="Open shared browser"
                aria-pressed={browserActive}
                type="button"
                disabled={disabled || browserOpening}
              >
                {browserOpening ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={styles.spin}>
                    <path d="M9 2a7 7 0 1 0 7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.4" />
                    <path d="M2 9h14M9 2c1.9 2 1.9 12 0 14M9 2c-1.9 2-1.9 12 0 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            )}
            {modelPicker && <div style={styles.modelSlot}>{modelPicker}</div>}
            {canStop ? (
              <button
                onClick={() => { lightHaptic(); onStop!(); }}
                className="hover-wash" style={styles.stopButton}
                aria-label="Stop generating"
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="8" height="8" rx="1.25" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => triggerSend()}
                disabled={!canSend}
                className="hover-wash" style={{ ...styles.sendButton, ...(!canSend ? styles.sendButtonDisabled : {}) }}
                aria-label="Send message"
              >
                <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 12V4M4 8l4-4 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "10px 12px calc(10px + var(--kb-safe-bottom, env(safe-area-inset-bottom, 0px)))",
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
  pastedChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "7px 32px 7px 10px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
    backgroundColor: "var(--bg-secondary)",
    position: "relative",
    flexShrink: 0,
    maxWidth: "240px",
  },
  pastedChipText: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    overflow: "hidden",
  },
  pastedChipName: {
    fontSize: "0.8125rem",
    color: "var(--text-primary)",
    fontWeight: "500",
    whiteSpace: "nowrap",
  },
  pastedChipMeta: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap",
  },
  pastedChipClose: {
    position: "absolute",
    top: "50%",
    right: "8px",
    transform: "translateY(-50%)",
    width: "18px",
    height: "18px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--border-strong)",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.875rem",
    cursor: "pointer",
    lineHeight: "1",
    fontWeight: "600",
    border: "none",
    padding: 0,
  },
  // The single rounded composer container — a VERTICAL stack (textarea row +
  // control row) so the typed text never wraps around the controls.
  box: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    padding: "8px 8px 8px 12px",
    transition: "border-color var(--transition), box-shadow var(--transition)",
    width: "100%",
    maxWidth: 780,
    margin: "0 auto",
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  controlLeft: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "36px",
  },
  controlRight: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  modelSlot: {
    display: "flex",
    alignItems: "center",
  },
  attachButton: {
    flexShrink: 0,
    width: "36px",
    height: "36px",
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
    width: "100%",
    border: "none",
    background: "transparent",
    color: "var(--text-primary)",
    // 16px exactly — anything smaller makes iOS auto-zoom into the field on
    // focus, which is part of the keyboard-open jump.
    fontSize: "1rem",
    lineHeight: "1.5",
    resize: "none",
    outline: "none",
    minHeight: "24px",
    maxHeight: "400px",
    overflowY: "auto",
    padding: "4px 4px 0",
    caretColor: "var(--accent)",
    WebkitAppearance: "none",
    boxSizing: "border-box",
  },
  boxFocused: {
    borderColor: "#0F6E56",
    boxShadow: "0 0 0 3px rgba(15, 110, 86, 0.10)",
  },
  sendButton: {
    flexShrink: 0,
    width: "36px",
    height: "36px",
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
  stopButton: {
    flexShrink: 0,
    width: "36px",
    height: "36px",
    borderRadius: "var(--radius-md)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    color: "var(--text-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background-color var(--transition), color var(--transition)",
    padding: 0,
  },
  browserButton: {
    flexShrink: 0,
    width: "36px",
    height: "36px",
    borderRadius: "var(--radius-md)",
    backgroundColor: "transparent",
    color: "var(--text-tertiary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "color var(--transition), background-color var(--transition)",
    border: "none",
    padding: 0,
  },
  browserButtonActive: {
    color: "#fff",
    backgroundColor: "var(--accent)",
  },
  spin: {
    animation: "bruce-browser-spin 0.8s linear infinite",
  },
};
