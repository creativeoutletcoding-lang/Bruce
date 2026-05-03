"use client";

import { useState, useRef } from "react";
import { MODELS, DEFAULT_MODEL, modelLabel } from "@/lib/models";

interface ModelPickerProps {
  currentModel: string;
  onSelect: (modelId: string) => void;
}

export default function ModelPicker({ currentModel, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleSelect(id: string) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={styles.pill}
        aria-label="Change model"
        type="button"
      >
        {modelLabel(currentModel)}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 3, flexShrink: 0 }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={styles.backdrop}
          />
          <div style={styles.sheet} className="model-picker-sheet">
            <div style={styles.sheetHandle} className="model-picker-handle" />
            <p style={styles.sheetTitle}>Choose model</p>
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => handleSelect(m.id)}
                style={{
                  ...styles.option,
                  ...(currentModel === m.id ? styles.optionActive : {}),
                }}
                type="button"
              >
                <div style={styles.optionHeader}>
                  <span style={styles.optionLabel}>{m.label}</span>
                  {m.id === DEFAULT_MODEL && (
                    <span style={styles.defaultBadge}>Default</span>
                  )}
                  {currentModel === m.id && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: "auto", flexShrink: 0 }}>
                      <path d="M2 7l4 4 6-6" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <p style={styles.optionDesc}>{m.description}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pill: {
    display: "flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: "var(--radius-full)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    fontSize: "0.75rem",
    fontWeight: "400",
    cursor: "pointer",
    transition: "border-color var(--transition)",
    flexShrink: 0,
    background: "transparent",
    gap: "2px",
  },
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 998,
  },
  sheet: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: "var(--bg-primary)",
    borderTop: "1px solid var(--border)",
    borderTopLeftRadius: "var(--radius-lg)",
    borderTopRightRadius: "var(--radius-lg)",
    padding: "12px 16px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  sheetHandle: {
    width: "32px",
    height: "4px",
    borderRadius: "2px",
    backgroundColor: "var(--border-strong)",
    margin: "0 auto 12px",
  },
  sheetTitle: {
    fontSize: "0.8125rem",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    marginBottom: "8px",
  },
  option: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "12px 14px",
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    cursor: "pointer",
    textAlign: "left",
    background: "transparent",
    width: "100%",
    transition: "background-color var(--transition)",
  },
  optionActive: {
    backgroundColor: "var(--bg-secondary)",
    borderColor: "var(--border)",
  },
  optionHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  optionLabel: {
    fontSize: "0.9375rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
  defaultBadge: {
    fontSize: "0.6875rem",
    fontWeight: "500",
    color: "var(--accent)",
    backgroundColor: "rgba(15, 110, 86, 0.1)",
    padding: "2px 6px",
    borderRadius: "var(--radius-full)",
  },
  optionDesc: {
    fontSize: "0.8125rem",
    color: "var(--text-secondary)",
    lineHeight: "1.4",
  },
};
