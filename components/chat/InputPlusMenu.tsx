"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lightHaptic } from "@/lib/utils/haptics";
import type { MovableProject } from "@/lib/types";
import { ProjectMemberPips } from "./ProjectPickerList";

export interface MoveToProjectConfig {
  projects: MovableProject[];
  onSelect: (projectId: string) => void;
  loading?: boolean;
  /** Sub-sheet title + grouped-row label. Defaults to "Add to project". */
  label?: string;
}

interface InputPlusMenuProps {
  /** Opens the camera (capture) for a single photo. Omit to hide the tile. */
  onTakePhoto?: () => void;
  /** Opens the photo library (images only). Omit to hide the tile. */
  onChoosePhotos?: () => void;
  /** Opens the document/file picker. Omit to hide the tile. */
  onChooseFiles?: () => void;
  /** Present only where add-to-project is eligible (e.g. standalone owned chats). */
  moveToProject?: MoveToProjectConfig;
  disabled?: boolean;
}

const DESKTOP_WIDTH = 280;

// The shared "+" ("Add to chat") menu for the composer. Presentation branches by
// pointer type (same approach as ModelPicker): TOUCH gets the Claude-iOS-style
// bottom sheet (grab handle, 3-tile attach row, grouped `›` rows, in-place
// "Add to project" sub-page); DESKTOP (mouse) gets an anchored popover — a
// vertical list of icon+label rows with thin group dividers and trailing
// affordances (a chevron on the submenu row). Same items/actions everywhere;
// only the layout differs. The popover uses position:fixed because the composer's
// overflow:hidden ancestors would clip an absolute dropdown (the ModelPicker bug).
export default function InputPlusMenu({
  onTakePhoto,
  onChoosePhotos,
  onChooseFiles,
  moveToProject,
  disabled = false,
}: InputPlusMenuProps) {
  const [open, setOpen] = useState(false);
  const [showProjects, setShowProjects] = useState(false);
  const [query, setQuery] = useState("");
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

  function close() {
    setOpen(false);
    setShowProjects(false);
    setQuery("");
  }

  // Escape closes (modal affordance). Backdrop click handles pointer dismiss.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showProjects) { setShowProjects(false); return; }
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, showProjects]);

  function toggleOpen() {
    if (disabled) return;
    lightHaptic();
    setShowProjects(false);
    setQuery("");
    setOpen((v) => {
      const next = !v;
      // Capture the trigger rect so the desktop popover can anchor to it.
      if (next && triggerRef.current) setAnchor(triggerRef.current.getBoundingClientRect());
      return next;
    });
  }

  function fireTile(handler?: () => void) {
    if (!handler) return;
    lightHaptic();
    close();
    handler();
  }

  function openProjects() {
    lightHaptic();
    setShowProjects(true);
  }

  function backToRoot() {
    lightHaptic();
    setShowProjects(false);
    setQuery("");
  }

  function handleSelectProject(projectId: string) {
    lightHaptic();
    close();
    moveToProject?.onSelect(projectId);
  }

  const hasTiles = Boolean(onTakePhoto || onChoosePhotos || onChooseFiles);

  // Once loaded, an empty project list disables the entry rather than opening an
  // empty sub-page (matches the prior behavior).
  const moveEmpty =
    Boolean(moveToProject) && !moveToProject!.loading && moveToProject!.projects.length === 0;
  const projectLabel = moveToProject?.label ?? "Add to project";

  const filteredProjects = useMemo(() => {
    const list = moveToProject?.projects ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [moveToProject?.projects, query]);

  const title = showProjects ? projectLabel : "Add to chat";

  // Desktop popover: a fixed box opening UPWARD from the trigger (the + sits at
  // the bottom of the composer), left-aligned to it and clamped to the viewport.
  const desktopPopoverStyle: React.CSSProperties | null =
    isDesktop && anchor
      ? {
          position: "fixed",
          width: DESKTOP_WIDTH,
          left: Math.min(anchor.left, window.innerWidth - DESKTOP_WIDTH - 8),
          bottom: Math.max(8, window.innerHeight - anchor.top + 6),
          maxHeight: anchor.top - 16,
          overflowY: "auto",
          zIndex: "var(--z-menu)" as unknown as number,
          backgroundColor: "var(--bg-primary)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-lg)",
          padding: "6px",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={toggleOpen}
        style={styles.trigger}
        aria-label="Add to chat"
        aria-haspopup="menu"
        aria-expanded={open}
        type="button"
        disabled={disabled}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/* DESKTOP (mouse): anchored popover — vertical icon+label rows, group
          dividers, trailing chevron on the submenu row. Same items/actions. */}
      {open && desktopPopoverStyle &&
        createPortal(
          <>
            <div style={styles.desktopBackdrop} onClick={close} />
            <div role="menu" aria-label={title} style={desktopPopoverStyle} onClick={(e) => e.stopPropagation()}>
              {showProjects && moveToProject ? (
                <>
                  <button type="button" className="hover-wash" style={styles.menuBackRow} onClick={backToRoot}>
                    <span style={styles.menuRowIcon}><ChevronLeft /></span>
                    <span style={styles.menuRowLabel}>{projectLabel}</span>
                  </button>
                  <div style={styles.menuDivider} aria-hidden="true" />
                  <ProjectSubPage
                    label={projectLabel}
                    projects={filteredProjects}
                    totalCount={moveToProject.projects.length}
                    loading={moveToProject.loading}
                    query={query}
                    onQueryChange={setQuery}
                    onSelect={handleSelectProject}
                  />
                </>
              ) : (
                <>
                  {onTakePhoto && (
                    <MenuRow label="Camera" icon={<CameraIcon />} onClick={() => fireTile(onTakePhoto)} />
                  )}
                  {onChoosePhotos && (
                    <MenuRow label="Photos" icon={<PhotosIcon />} onClick={() => fireTile(onChoosePhotos)} />
                  )}
                  {onChooseFiles && (
                    <MenuRow label="Files" icon={<FilesIcon />} onClick={() => fireTile(onChooseFiles)} />
                  )}

                  {hasTiles && moveToProject && <div style={styles.menuDivider} aria-hidden="true" />}

                  {moveToProject && (
                    <MenuRow
                      label={moveEmpty ? "No projects available" : projectLabel}
                      icon={<FolderIcon />}
                      onClick={moveEmpty ? undefined : openProjects}
                      disabled={moveEmpty}
                      trailing={!moveEmpty ? <ChevronRight /> : undefined}
                    />
                  )}
                </>
              )}
            </div>
          </>,
          document.body
        )}

      {/* MOBILE (touch): the existing bottom sheet — unchanged. */}
      {open && !desktopPopoverStyle &&
        createPortal(
          <div style={styles.backdrop} onClick={close}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              style={styles.sheet}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={styles.handle} aria-hidden="true" />

              {/* Header: left affordance (X on root, ‹ back on sub-page),
                  centered title, balancing spacer on the right. */}
              <div style={styles.header}>
                {showProjects ? (
                  <button type="button" style={styles.headerBtn} onClick={backToRoot} aria-label="Back">
                    <ChevronLeft />
                  </button>
                ) : (
                  <button type="button" style={styles.headerBtn} onClick={close} aria-label="Close">
                    <CloseIcon />
                  </button>
                )}
                <span style={styles.title}>{title}</span>
                <span style={styles.headerBtn} aria-hidden="true" />
              </div>

              {/* In-place page transition between the root sheet and the
                  Add-to-project sub-page (keyed so the animation replays). */}
              <div
                key={showProjects ? "projects" : "root"}
                style={{
                  ...styles.page,
                  animationName: showProjects ? "bruce-sheet-page-fwd" : "bruce-sheet-page-back",
                }}
              >
                {showProjects && moveToProject ? (
                  <ProjectSubPage
                    label={projectLabel}
                    projects={filteredProjects}
                    totalCount={moveToProject.projects.length}
                    loading={moveToProject.loading}
                    query={query}
                    onQueryChange={setQuery}
                    onSelect={handleSelectProject}
                  />
                ) : (
                  <>
                    {hasTiles && (
                      <div style={styles.tileRow}>
                        {onTakePhoto && (
                          <Tile label="Camera" onClick={() => fireTile(onTakePhoto)} icon={<CameraIcon />} />
                        )}
                        {onChoosePhotos && (
                          <Tile label="Photos" onClick={() => fireTile(onChoosePhotos)} icon={<PhotosIcon />} />
                        )}
                        {onChooseFiles && (
                          <Tile label="Files" onClick={() => fireTile(onChooseFiles)} icon={<FilesIcon />} />
                        )}
                      </div>
                    )}

                    {moveToProject && (
                      <div style={styles.groupCard}>
                        <button
                          type="button"
                          style={{ ...styles.groupRow, ...(moveEmpty ? styles.rowDisabled : {}) }}
                          onClick={moveEmpty ? undefined : openProjects}
                          disabled={moveEmpty}
                        >
                          <span style={styles.rowIcon}><FolderIcon /></span>
                          <span style={styles.rowLabel}>
                            {moveEmpty ? "No projects available" : projectLabel}
                          </span>
                          {!moveEmpty && <ChevronRight />}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function ProjectSubPage({
  label,
  projects,
  totalCount,
  loading,
  query,
  onQueryChange,
  onSelect,
}: {
  label: string;
  projects: MovableProject[];
  totalCount: number;
  loading?: boolean;
  query: string;
  onQueryChange: (v: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {totalCount > 0 && (
        <div style={styles.searchWrap}>
          <span style={styles.searchIcon} aria-hidden="true"><SearchIcon /></span>
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search projects"
            style={styles.searchInput}
            aria-label={`Search ${label.toLowerCase()}`}
            autoComplete="off"
          />
        </div>
      )}

      <div style={styles.projectList}>
        {loading ? (
          <div style={styles.emptyMsg}>Loading projects…</div>
        ) : totalCount === 0 ? (
          <div style={styles.emptyMsg}>No projects available</div>
        ) : projects.length === 0 ? (
          <div style={styles.emptyMsg}>No projects match “{query.trim()}”</div>
        ) : (
          <div style={styles.groupCard}>
            {projects.map((p, i) => (
              <button
                key={p.id}
                type="button"
                style={{
                  ...styles.projectRow,
                  ...(i < projects.length - 1 ? styles.rowDivider : {}),
                }}
                onClick={() => onSelect(p.id)}
              >
                {/* Leading per-project emoji intentionally omitted here (this
                    sub-sheet only) — name sits at the card's standard left
                    inset. The project's icon data is untouched in the DB. */}
                <span style={styles.projectText}>
                  <span style={styles.projectName}>{p.name}</span>
                  <span style={styles.projectMeta}>{timeAgo(p.created_at)}</span>
                </span>
                <ProjectMemberPips members={p.members} />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Tile({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" style={styles.tile} onClick={onClick} className="hover-wash">
      <span style={styles.tileIcon}>{icon}</span>
      <span style={styles.tileLabel}>{label}</span>
    </button>
  );
}

// A single desktop-popover row: leading icon + label, optional trailing affordance
// (chevron for a submenu; a shortcut hint or checkmark would slot here too, but no
// current menu item is a toggle or has a shortcut). hover-wash gives the hover bg.
function MenuRow({
  label,
  icon,
  onClick,
  disabled = false,
  trailing,
}: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={disabled ? undefined : "hover-wash"}
      style={{ ...styles.menuRow, ...(disabled ? styles.rowDisabled : {}) }}
      onClick={onClick}
      disabled={disabled}
    >
      <span style={styles.menuRowIcon}>{icon}</span>
      <span style={styles.menuRowLabel}>{label}</span>
      {trailing}
    </button>
  );
}

/** Relative "x ago" for the project list. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="12.5" r="3.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PhotosIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 17l4.5-4.5 3 3L16 12l3 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 3v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
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
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: "var(--z-modal)" as unknown as number,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    animation: "bruce-sheet-backdrop-in 160ms ease-out",
  },
  // Desktop popover (rows + dividers). Transparent click-catcher behind it so an
  // outside click dismisses without dimming the page (the menu is a light popover,
  // not a modal). Sits just under the popover on the z-menu layer.
  desktopBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: "calc(var(--z-menu) - 1)" as unknown as number,
  },
  menuRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "9px 10px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
    borderRadius: "var(--radius-md)",
  },
  menuBackRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "9px 10px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-secondary)",
    borderRadius: "var(--radius-md)",
    fontWeight: 600,
  },
  menuRowIcon: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    color: "var(--text-secondary)",
  },
  menuRowLabel: {
    flex: 1,
    fontSize: "0.875rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  menuDivider: {
    height: "1px",
    backgroundColor: "var(--border)",
    margin: "4px 6px",
  },
  sheet: {
    width: "100%",
    maxWidth: "480px",
    backgroundColor: "var(--bg-primary)",
    borderTopLeftRadius: "var(--radius-lg)",
    borderTopRightRadius: "var(--radius-lg)",
    boxShadow: "var(--shadow-lg)",
    padding: "6px 12px calc(16px + var(--kb-safe-bottom, env(safe-area-inset-bottom, 0px)))",
    maxHeight: "82vh",
    display: "flex",
    flexDirection: "column",
    animation: "bruce-sheet-up 220ms cubic-bezier(0.32, 0.72, 0, 1)",
  },
  handle: {
    width: "36px",
    height: "4px",
    borderRadius: "2px",
    backgroundColor: "var(--border-strong)",
    margin: "6px auto 4px",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "40px",
    flexShrink: 0,
  },
  headerBtn: {
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    padding: 0,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: "0.9375rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  page: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
    animationDuration: "200ms",
    animationTimingFunction: "ease-out",
    animationFillMode: "both",
  },
  tileRow: {
    display: "flex",
    gap: "8px",
    margin: "8px 0 4px",
  },
  tile: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    padding: "16px 8px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    color: "var(--text-primary)",
  },
  tileIcon: {
    color: "var(--text-primary)",
    display: "flex",
  },
  tileLabel: {
    fontSize: "0.8125rem",
    fontWeight: 500,
  },
  groupCard: {
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    margin: "8px 0 0",
  },
  groupRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    padding: "13px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  },
  rowDisabled: {
    opacity: 0.5,
    cursor: "default",
  },
  rowIcon: {
    flexShrink: 0,
    display: "flex",
    color: "var(--text-secondary)",
  },
  rowLabel: {
    flex: 1,
    fontSize: "0.9375rem",
    fontWeight: 500,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  searchWrap: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    margin: "8px 0 4px",
    flexShrink: 0,
  },
  searchIcon: {
    position: "absolute",
    left: "12px",
    color: "var(--text-tertiary)",
    display: "flex",
    pointerEvents: "none",
  },
  searchInput: {
    width: "100%",
    padding: "10px 12px 10px 36px",
    fontSize: "1rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    WebkitAppearance: "none",
    boxSizing: "border-box",
  },
  projectList: {
    paddingBottom: "4px",
  },
  projectRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "12px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  },
  rowDivider: {
    borderBottom: "0.5px solid var(--border)",
  },
  projectText: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  projectName: {
    fontSize: "0.9375rem",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  projectMeta: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
  },
  emptyMsg: {
    padding: "20px 14px",
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    textAlign: "center",
  },
};
