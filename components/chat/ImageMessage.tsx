"use client";

import { useState } from "react";

interface ImageMessageProps {
  url: string;
  prompt: string;
  isHD?: boolean;
}

export default function ImageMessage({ url, prompt, isHD }: ImageMessageProps) {
  const [imgError, setImgError] = useState(false);
  const caption = prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt;

  if (imgError) {
    return (
      <div style={styles.wrapper}>
        <a href={url} target="_blank" rel="noopener noreferrer" style={styles.fallbackLink}>
          View image →
        </a>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={styles.link}
        aria-label={`Generated image: ${caption}`}
      >
        <div style={styles.imageWrapper}>
          <img
            src={url}
            alt={prompt}
            style={styles.image}
            onError={() => setImgError(true)}
          />
          {isHD && <span style={styles.hdBadge}>HD</span>}
        </div>
      </a>
      <p style={styles.caption}>{caption}</p>
    </div>
  );
}

interface SkeletonProps {
  isHD?: boolean;
}

export function ImageMessageSkeleton({ isHD }: SkeletonProps) {
  return (
    <div style={styles.wrapper}>
      <div style={styles.skeleton}>
        {isHD && <span style={styles.skeletonLabel}>Generating HD image…</span>}
      </div>
      <p style={styles.captionLoading}>{isHD ? "Generating HD image…" : "Generating image…"}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "2px 16px",
    maxWidth: "min(420px, 90vw)",
  },
  link: {
    display: "block",
    borderRadius: "8px",
    overflow: "hidden",
    lineHeight: 0,
  },
  imageWrapper: {
    position: "relative" as const,
    lineHeight: 0,
  },
  image: {
    width: "100%",
    maxHeight: "400px",
    objectFit: "cover" as const,
    borderRadius: "8px",
    display: "block",
    cursor: "pointer",
  },
  hdBadge: {
    position: "absolute" as const,
    top: "8px",
    right: "8px",
    padding: "2px 6px",
    borderRadius: "4px",
    fontSize: "0.6875rem",
    fontWeight: "600",
    letterSpacing: "0.04em",
    backgroundColor: "rgba(0,0,0,0.45)",
    color: "rgba(255,255,255,0.9)",
    lineHeight: "1.4",
    pointerEvents: "none" as const,
  },
  caption: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    lineHeight: "1.4",
  },
  skeleton: {
    width: "100%",
    height: "280px",
    borderRadius: "8px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    animation: "pulse 1.5s ease-in-out infinite",
    display: "flex",
    alignItems: "flex-end",
    padding: "12px",
  },
  skeletonLabel: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    lineHeight: "1.4",
  },
  captionLoading: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
  },
  fallbackLink: {
    fontSize: "0.875rem",
    color: "var(--accent)",
    textDecoration: "none",
    padding: "2px 0",
  },
};
