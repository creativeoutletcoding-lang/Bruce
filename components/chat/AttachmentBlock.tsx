"use client";

export type AttachmentBlockType = "pasted_text" | "image" | "document";

interface AttachmentBlockProps {
  type: AttachmentBlockType;
  label: string;
  meta?: string;
  thumbnailUrl?: string;
  onClick?: () => void;
}

export default function AttachmentBlock({ type, label, meta, thumbnailUrl, onClick }: AttachmentBlockProps) {
  return (
    <button
      onClick={onClick}
      style={styles.block}
      type="button"
      aria-label={`View ${label}`}
    >
      <div style={styles.iconWrap}>
        {type === "image" && thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" style={styles.thumbnail} />
        ) : (
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" style={{ color: "var(--text-secondary)" }}>
            <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div style={styles.text}>
        <span style={styles.label}>{label}</span>
        {meta && <span style={styles.meta}>{meta}</span>}
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={styles.chevron} aria-hidden="true">
        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  block: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "9px 12px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border-strong)",
    backgroundColor: "var(--bg-secondary)",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    maxWidth: "280px",
    transition: "background-color var(--transition)",
  },
  iconWrap: {
    flexShrink: 0,
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-sm)",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  thumbnail: {
    width: "32px",
    height: "32px",
    objectFit: "cover",
    display: "block",
  },
  text: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  label: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  meta: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chevron: {
    flexShrink: 0,
    color: "var(--text-tertiary)",
  },
};
