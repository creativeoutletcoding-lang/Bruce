"use client";

import { useEffect, useRef, useState } from "react";
import type { MovableProject } from "@/lib/types";
import ProjectPickerList from "./ProjectPickerList";

interface ProjectAssignSelectorProps {
  projects: MovableProject[];
  selected: { id: string; name: string } | null;
  onSelect: (project: { id: string; name: string }) => void;
  onClear: () => void;
  loading?: boolean;
}

// Subtle "assign this new chat to a project" control for the welcome screen.
// Reuses the shared ProjectPickerList in a small popover. When a project is
// chosen it collapses to a dismissible pill.
export default function ProjectAssignSelector({
  projects,
  selected,
  onSelect,
  onClear,
  loading,
}: ProjectAssignSelectorProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("touchstart", onDown, { passive: true });
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} style={styles.wrapper}>
      {selected ? (
        <div style={styles.pill}>
          <FolderIcon />
          <span style={styles.pillName}>{selected.name}</span>
          <button
            type="button"
            onClick={onClear}
            style={styles.clearBtn}
            aria-label="Remove from project"
          >
            ×
          </button>
        </div>
      ) : (
        <button type="button" style={styles.trigger} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
          <FolderIcon />
          <span>Add to project</span>
        </button>
      )}

      {open && !selected && (
        <div style={styles.popover}>
          <ProjectPickerList
            projects={projects}
            loading={loading}
            onSelect={(projectId) => {
              const p = projects.find((x) => x.id === projectId);
              if (p) onSelect({ id: p.id, name: p.name });
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-tertiary)" }}>
      <path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5A1.5 1.5 0 0 1 14.5 7v5A1.5 1.5 0 0 1 13 13.5H3.5A1.5 1.5 0 0 1 2 12V5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    marginTop: "10px",
  },
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 10px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    borderRadius: "var(--radius-full)",
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "5px 6px 5px 10px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--bg-secondary)",
    fontSize: "0.8125rem",
    color: "var(--text-secondary)",
  },
  pillName: {
    maxWidth: "200px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  clearBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: "var(--radius-full)",
    border: "none",
    background: "transparent",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    fontSize: "1rem",
    lineHeight: 1,
    padding: 0,
  },
  popover: {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)",
    minWidth: "240px",
    maxHeight: "300px",
    overflowY: "auto",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    padding: "4px",
    zIndex: 1000,
  },
};
