"use client";

import { useState } from "react";
import type { WorkingLogDisplayItem } from "@/lib/chat/workingLog";

interface WorkingLogProps {
  items: WorkingLogDisplayItem[];
  /** Live-appending during the run — header reads "Working…". */
  isStreaming?: boolean;
}

// Collapsed expandable container for Bruce's working process — narration
// paragraphs interleaved chronologically with tool status lines. Rendered
// under the task card header when a task is active, standalone otherwise.
// The reply streams into the normal bubble below it.
export default function WorkingLog({ items, isStreaming = false }: WorkingLogProps) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  const toolCount = items.filter((i) => i.kind === "tool").length;
  const label = isStreaming
    ? "Working…"
    : `Show work${toolCount > 0 ? ` (${toolCount} ${toolCount === 1 ? "step" : "steps"})` : ""}`;

  return (
    <div style={styles.container}>
      <button
        type="button"
        className="hover-wash hit-target"
        style={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          style={{
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s ease",
            flexShrink: 0,
          }}
        >
          <path d="M3 1.5 7 5l-4 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={isStreaming ? { animation: "pulse 2s ease-in-out infinite" } : undefined}>
          {label}
        </span>
      </button>

      {expanded && (
        <div style={styles.body}>
          {items.map((item, i) =>
            item.kind === "narration" ? (
              <div key={i} style={styles.narration}>
                {item.text}
              </div>
            ) : (
              <div key={i} style={styles.toolRow}>
                <span
                  style={{
                    ...styles.toolIcon,
                    color: item.status === "error" ? "#ef4444" : "var(--accent)",
                  }}
                >
                  {item.status === "error" ? "✗" : "✓"}
                </span>
                <span style={styles.toolLabel}>
                  {item.label}
                  {item.detail && <span style={styles.toolDetail}> · {item.detail}</span>}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderLeft: "2px solid var(--border)",
    paddingLeft: "10px",
    marginBottom: "6px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "2px 6px 2px 2px",
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    position: "relative",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "6px 2px 2px",
  },
  narration: {
    fontSize: "0.8125rem",
    lineHeight: 1.5,
    color: "var(--text-tertiary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  toolRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    lineHeight: 1.5,
  },
  toolIcon: {
    fontSize: "11px",
    flexShrink: 0,
  },
  toolLabel: {
    fontSize: "0.8125rem",
    color: "var(--text-secondary)",
  },
  toolDetail: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
  },
};
