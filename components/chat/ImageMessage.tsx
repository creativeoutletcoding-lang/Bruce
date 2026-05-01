"use client";

import { useState } from "react";

interface ImageMessageProps {
  url: string;
  prompt: string;
}

export default function ImageMessage({ url, prompt }: ImageMessageProps) {
  const [imgError, setImgError] = useState(false);
  const caption = prompt.length > 80 ? prompt.slice(0, 80) + "…" : prompt;

  if (imgError) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.error}>Image generation failed. Try again.</div>
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
        <img
          src={url}
          alt={prompt}
          style={styles.image}
          onError={() => setImgError(true)}
        />
      </a>
      <p style={styles.caption}>{caption}</p>
    </div>
  );
}

export function ImageMessageSkeleton() {
  return (
    <div style={styles.wrapper}>
      <div style={styles.skeleton} />
      <p style={styles.captionLoading}>Generating image…</p>
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
  image: {
    width: "100%",
    maxHeight: "400px",
    objectFit: "cover",
    borderRadius: "8px",
    display: "block",
    cursor: "pointer",
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
  },
  captionLoading: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
  },
  error: {
    padding: "12px 16px",
    borderRadius: "8px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    fontSize: "0.875rem",
    color: "var(--text-secondary)",
  },
};
