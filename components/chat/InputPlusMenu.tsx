"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lightHaptic } from "@/lib/utils/haptics";
import type { MovableProject } from "@/lib/types";
import ProjectPickerList from "./ProjectPickerList";

export interface MoveToProjectConfig {
  projects: MovableProject[];
  onSelect: (projectId: string) => void;
  loading?: boolean;
}

interface InputPlusMenuProps {
  /** Opens the native file picker. Omit to hide the "Attach file" item. */
  onAttachFile?: () => void;
  /** Present only on standalone private chats the user owns and hasn't moved yet. */
  moveToProject?: MoveToProjectConfig;
  disabled?: boolean;
}

// The shared "+" menu for the input bar. First level lists actions (Attach file,
// Move to project). "Move to project" opens a second level: an inline flyout on
// desktop, a second bottom sheet on mobile (bigger touch targets). One component
// for every chat context — variations come from props, never from forking.
export default function InputPlusMenu({ onAttachFile, moveToProject, disabled = false }: InputPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [isCoarse, setIsCoarse] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsCoarse(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  function close() {
    setOpen(false);
    setShowProjects(false);
  }

  // Desktop: dismiss on outside mousedown. (Mobile uses the sheet backdrop.)
  useEffect(() => {
    if (!open || isCoarse) return;
    function onDown(e: MouseEvent) {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      close();
    }
    const t = setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDown); };
  }, [open, isCoarse]);

  function handleAttach() {
    close();
    onAttachFile?.();
  }

  function handleSelectProject(projectId: string) {
    close();
    moveToProject?.onSelect(projectId);
  }

  function toggleOpen() {
    if (disabled) return;
    lightHaptic();
    setOpen((v) => !v);
    setShowProjects(false);
  }

  // Once loaded, an empty project list disables the entry (spec: relabel rather
  // than open an empty picker). While loading, keep it enabled — the picker shows
  // a loading line.
  const moveEmpty = Boolean(moveToProject) && !moveToProject!.loading && moveToProject!.projects.length === 0;

  const items = (
    <div role="menu">
      {onAttachFile && (
        <button type="button" role="menuitem" style={styles.item} onClick={handleAttach}>
          <PaperclipIcon />
          <span style={styles.itemLabel}>Attach file</span>
        </button>
      )}
      {moveToProject && (
        <button
          type="button"
          role="menuitem"
          style={{ ...styles.item, ...(moveEmpty ? styles.itemDisabled : {}) }}
          onClick={moveEmpty ? undefined : () => setShowProjects(true)}
          disabled={moveEmpty}
        >
          <FolderIcon />
          <span style={styles.itemLabel}>{moveEmpty ? "No projects available" : "Move to project"}</span>
          {!moveEmpty && <ChevronRight />}
        </button>
      )}
    </div>
  );

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "flex" }}>
      <button
        onClick={toggleOpen}
        style={styles.trigger}
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* Desktop: popover above the trigger; project flyout to the right. */}
      {open && !isCoarse && (
        <div style={styles.desktopPopover}>
          {items}
          {showProjects && moveToProject && (
            <div style={styles.desktopFlyout}>
              <ProjectPickerList
                projects={moveToProject.projects}
                onSelect={handleSelectProject}
                loading={moveToProject.loading}
              />
            </div>
          )}
        </div>
      )}

      {/* Mobile: bottom sheet; "Move to project" swaps to a second sheet. */}
      {open && isCoarse && createPortal(
        <div style={styles.sheetBackdrop} onClick={close}>
          <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.sheetHandle} aria-hidden="true" />
            {showProjects && moveToProject ? (
              <>
                <button type="button" style={styles.sheetBack} onClick={() => setShowProjects(false)}>
                  <ChevronLeft />
                  <span>Move to project</span>
                </button>
                <ProjectPickerList
                  projects={moveToProject.projects}
                  onSelect={handleSelectProject}
                  loading={moveToProject.loading}
                />
              </>
            ) : (
              items
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={iconStyle}>
      <path d="M15 9.5l-5.5 5.5a4 4 0 0 1-5.657-5.657l6-6a2.5 2.5 0 0 1 3.535 3.535L7.5 12.5a1 1 0 0 1-1.414-1.414L11.5 5.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" style={iconStyle}>
      <path d="M2 5.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h5A1.5 1.5 0 0 1 14.5 7v5A1.5 1.5 0 0 1 13 13.5H3.5A1.5 1.5 0 0 1 2 12V5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-tertiary)" }}>
      <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const iconStyle: React.CSSProperties = { flexShrink: 0, color: "var(--text-secondary)" };

const styles: Record<string, React.CSSProperties> = {
  trigger: {
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
  desktopPopover: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    left: 0,
    minWidth: "200px",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    padding: "4px",
    zIndex: 1000,
  },
  desktopFlyout: {
    position: "absolute",
    left: "calc(100% + 6px)",
    bottom: 0,
    minWidth: "240px",
    maxHeight: "320px",
    overflowY: "auto",
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    padding: "4px",
    zIndex: 1001,
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "9px 10px",
    background: "transparent",
    border: "none",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  },
  itemLabel: {
    flex: 1,
    fontSize: "0.875rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  itemDisabled: {
    opacity: 0.5,
    cursor: "default",
  },
  sheetBackdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: 2000,
    display: "flex",
    alignItems: "flex-end",
  },
  sheet: {
    width: "100%",
    backgroundColor: "var(--bg-primary)",
    borderTopLeftRadius: "var(--radius-lg)",
    borderTopRightRadius: "var(--radius-lg)",
    padding: "8px 8px calc(16px + env(safe-area-inset-bottom, 0px))",
    boxShadow: "var(--shadow-lg)",
    maxHeight: "70vh",
    overflowY: "auto",
  },
  sheetHandle: {
    width: "36px",
    height: "4px",
    borderRadius: "2px",
    backgroundColor: "var(--border-strong)",
    margin: "6px auto 10px",
  },
  sheetBack: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    padding: "10px 12px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid var(--border)",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: 600,
    color: "var(--text-primary)",
    marginBottom: "4px",
  },
};
