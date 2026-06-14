"use client";

import { useState, useRef, useEffect } from "react";
import { MODELS, DEFAULT_MODEL, modelLabel, getModel, validEffortForModel } from "@/lib/models";

interface ModelPickerProps {
  currentModel: string;
  onSelect: (modelId: string) => void;
  /** Current effort preference (raw). When omitted, the effort row is hidden. */
  currentEffort?: string | null;
  onEffortChange?: (effort: string) => void;
}

const DESKTOP_WIDTH = 280;

export default function ModelPicker({ currentModel, onSelect, currentEffort, onEffortChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  // Desktop (mouse) gets a fixed popover anchored to the trigger; touch gets the
  // bottom sheet. We branch in JS rather than CSS because the popover must use
  // position:fixed to escape the composer's overflow:hidden ancestors (an
  // absolute dropdown was clipped off-screen on desktop — the original bug).
  const [isDesktop, setIsDesktop] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const selectedModel = getModel(currentModel);
  const showEffort = !!onEffortChange && !!selectedModel?.supportsEffort;
  // Effective effort = requested clamped to what this model supports (else default).
  const activeEffort = validEffortForModel(currentModel, currentEffort);

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next && triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect());
      return next;
    });
  }

  function handleSelect(id: string) {
    onSelect(id);
    setOpen(false);
  }

  // Desktop: fixed popover opening UPWARD from the trigger (the pill sits at the
  // bottom of the composer), right-aligned to it, clamped to the viewport.
  const desktopSheetStyle: React.CSSProperties | null =
    isDesktop && anchor
      ? {
          position: "fixed",
          width: DESKTOP_WIDTH,
          left: Math.max(8, anchor.right - DESKTOP_WIDTH),
          bottom: Math.max(8, window.innerHeight - anchor.top + 6),
          maxHeight: anchor.top - 16,
          overflowY: "auto",
          zIndex: 999,
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
          padding: "12px 16px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }
      : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={toggleOpen}
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
          <div style={desktopSheetStyle ?? styles.sheet}>
            {!desktopSheetStyle && <div style={styles.sheetHandle} />}
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
                  <span style={styles.optionLabel}>{m.displayName}</span>
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

            {showEffort && selectedModel && (
              <div style={styles.effortBlock}>
                <p style={styles.sheetTitle}>Effort</p>
                <div style={styles.effortRow}>
                  {selectedModel.effortLevels.map((level) => (
                    <button
                      key={level}
                      onClick={() => onEffortChange!(level)}
                      style={{
                        ...styles.effortChip,
                        ...(activeEffort === level ? styles.effortChipActive : {}),
                      }}
                      type="button"
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
    fontSize: "0.75rem",
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
  effortBlock: {
    marginTop: "8px",
    paddingTop: "12px",
    borderTop: "1px solid var(--border)",
  },
  effortRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  effortChip: {
    flex: "1 1 auto",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: "0.8125rem",
    fontWeight: "500",
    textTransform: "capitalize" as const,
    cursor: "pointer",
    transition: "background-color var(--transition), border-color var(--transition), color var(--transition)",
  },
  effortChipActive: {
    backgroundColor: "var(--bg-secondary)",
    borderColor: "var(--accent)",
    color: "var(--text-primary)",
  },
};
