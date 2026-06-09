"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ChatTopBar from "@/components/chat/ChatTopBar";
import { getDisplayName, getProfileColor } from "@/lib/chat/senderProfile";
import type { UserSummary } from "@/lib/types";

interface FamilyThreadTopBarProps {
  threadId: string;
  threadName: string;
  allMembers: UserSummary[];
  threadMemberIds: string[];
  excludedMemberIds?: string[];
}

export default function FamilyThreadTopBar({
  threadId,
  threadName,
  allMembers,
  threadMemberIds,
  excludedMemberIds = [],
}: FamilyThreadTopBarProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  // Track current member IDs locally so newly added members disappear from the picker
  const [currentMemberIds, setCurrentMemberIds] = useState<string[]>(threadMemberIds);
  // Track the name locally so renames are reflected immediately without a page reload
  const [currentName, setCurrentName] = useState(threadName);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(threadName);
  const [isRenaming, setIsRenaming] = useState(false);

  const threadMembers = allMembers.filter((m) => currentMemberIds.includes(m.id));
  const addableMembers = allMembers.filter(
    (m) => !currentMemberIds.includes(m.id) && !excludedMemberIds.includes(m.id)
  );

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await fetch(`/api/family/threads/${threadId}`, { method: "DELETE" });
      router.push("/chat");
    } catch {
      setIsDeleting(false);
      setDeleteModalOpen(false);
    }
  }

  async function handleAddMember() {
    if (!selectedUserId || isAdding) return;
    setIsAdding(true);
    try {
      const res = await fetch(`/api/family/threads/${threadId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      if (res.ok) {
        setCurrentMemberIds((prev) => [...prev, selectedUserId]);
        setSelectedUserId(null);
        setAddMemberOpen(false);
      }
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRename() {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === currentName || isRenaming) return;
    setIsRenaming(true);
    try {
      const res = await fetch(`/api/family/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        setCurrentName(trimmed);
        setRenameOpen(false);
      }
    } finally {
      setIsRenaming(false);
    }
  }

  const rightCluster = (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0, position: "relative" }}>
      {threadMembers.length > 0 && (
        <button
          onClick={() => setMemberSheetOpen(true)}
          style={styles.avatarStackButton}
          aria-label="View members"
        >
          {threadMembers.slice(0, 3).map((m, i) => (
            <div
              key={m.id}
              style={{
                width: 22,
                height: 22,
                borderRadius: "var(--radius-full)",
                border: "1.5px solid var(--bg-primary)",
                overflow: "hidden",
                marginLeft: i === 0 ? 0 : -7,
                zIndex: 3 - i,
                position: "relative",
                backgroundColor: getProfileColor(m.id, m.color_hex),
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.5rem",
                  fontWeight: "700",
                  color: "#fff",
                }}
              >
                {m.name.charAt(0).toUpperCase()}
              </div>
            </div>
          ))}
          {threadMembers.length > 3 && (
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "var(--radius-full)",
                border: "1.5px solid var(--bg-primary)",
                backgroundColor: "var(--bg-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginLeft: -7,
                flexShrink: 0,
                fontSize: "0.5rem",
                fontWeight: "700",
                color: "var(--text-secondary)",
              }}
            >
              +{threadMembers.length - 3}
            </div>
          )}
        </button>
      )}

      <button
        onClick={() => setMenuOpen((v) => !v)}
        style={styles.menuButton}
        aria-label="Group chat options"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="4" r="1.3" fill="currentColor" />
          <circle cx="9" cy="9" r="1.3" fill="currentColor" />
          <circle cx="9" cy="14" r="1.3" fill="currentColor" />
        </svg>
      </button>

      {menuOpen && (
        <>
          <div style={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
          <div style={styles.dropdown}>
            <button
              style={styles.dropdownItem}
              onClick={() => {
                setMenuOpen(false);
                setRenameValue(currentName);
                setRenameOpen(true);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M9.5 2.5l2 2-7 7H2.5v-2l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Rename
            </button>
            <button
              style={styles.dropdownItem}
              onClick={() => {
                setMenuOpen(false);
                setSelectedUserId(null);
                setAddMemberOpen(true);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <circle cx="6" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                <path d="M1 12.5c0-2.485 2.239-4.5 5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M11 9v4M9 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Add member
            </button>
            <button
              style={styles.dropdownItemDanger}
              onClick={() => {
                setMenuOpen(false);
                setDeleteModalOpen(true);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M2 3.5h10M5.5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M3.5 3.5l.5 8h6l.5-8"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Delete group chat
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <ChatTopBar
        left={
          <button
            onClick={() => router.push("/chat")}
            style={styles.backButton}
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M11 4L5 9l6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        }
        title={currentName}
        right={rightCluster}
      />

      {/* Add Member modal */}
      {addMemberOpen && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <p style={styles.modalTitle}>Add member</p>
            {addableMembers.length === 0 ? (
              <p style={styles.modalBody}>All household members are already in this group chat.</p>
            ) : (
              <>
                <p style={styles.modalBody}>Choose a household member to add.</p>
                <div style={styles.memberList}>
                  {addableMembers.map((member) => (
                    <button
                      key={member.id}
                      style={{
                        ...styles.memberRow,
                        ...(selectedUserId === member.id ? styles.memberRowSelected : {}),
                      }}
                      onClick={() => setSelectedUserId(member.id)}
                    >
                      <div style={{ ...styles.memberAvatar, backgroundColor: getProfileColor(member.id, member.color_hex) }}>
                        <span style={styles.avatarInitial}>{member.name.charAt(0)}</span>
                      </div>
                      <span style={styles.memberName}>{getDisplayName(member.name)}</span>
                      {selectedUserId === member.id && (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={styles.checkIcon} aria-hidden="true">
                          <path d="M3 8l4 4 6-7" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div style={styles.modalActions}>
              <button
                style={styles.cancelButton}
                onClick={() => { setAddMemberOpen(false); setSelectedUserId(null); }}
                disabled={isAdding}
              >
                Cancel
              </button>
              {addableMembers.length > 0 && (
                <button
                  style={{
                    ...styles.addButton,
                    ...(!selectedUserId || isAdding ? styles.addButtonDisabled : {}),
                  }}
                  onClick={handleAddMember}
                  disabled={!selectedUserId || isAdding}
                >
                  {isAdding ? "Adding…" : "Add"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rename modal */}
      {renameOpen && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <p style={styles.modalTitle}>Rename group chat</p>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenameOpen(false);
              }}
              placeholder="Group chat name"
              autoFocus
              style={styles.renameInput}
            />
            <div style={styles.modalActions}>
              <button
                style={styles.cancelButton}
                onClick={() => setRenameOpen(false)}
                disabled={isRenaming}
              >
                Cancel
              </button>
              <button
                style={{
                  ...styles.addButton,
                  ...(!renameValue.trim() || renameValue.trim() === currentName || isRenaming
                    ? styles.addButtonDisabled
                    : {}),
                }}
                onClick={handleRename}
                disabled={!renameValue.trim() || renameValue.trim() === currentName || isRenaming}
              >
                {isRenaming ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Member sheet */}
      {memberSheetOpen && (
        <div style={styles.overlay} onClick={() => setMemberSheetOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p style={styles.modalTitle}>Members</p>
            <div style={styles.memberList}>
              {threadMembers.map((m) => (
                <div key={m.id} style={styles.memberRow}>
                  <div style={{ ...styles.memberAvatar, backgroundColor: getProfileColor(m.id, m.color_hex) }}>
                    <span style={styles.avatarInitial}>{m.name.charAt(0)}</span>
                  </div>
                  <span style={styles.memberName}>{m.name}</span>
                </div>
              ))}
            </div>
            <div style={styles.modalActions}>
              <button style={styles.cancelButton} onClick={() => setMemberSheetOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteModalOpen && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <p style={styles.modalTitle}>Delete &ldquo;{currentName}&rdquo;?</p>
            <p style={styles.modalBody}>
              This removes the group chat and all its messages for everyone.
            </p>
            <div style={styles.modalActions}>
              <button
                style={styles.cancelButton}
                onClick={() => setDeleteModalOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                style={styles.deleteButton}
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    flexShrink: 0,
    transition: "color var(--transition)",
  },
  avatarStackButton: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
    padding: "4px 6px",
    borderRadius: "var(--radius-sm)",
    flexShrink: 0,
    transition: "opacity var(--transition)",
  },
  menuButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    color: "var(--text-secondary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    flexShrink: 0,
    transition: "color var(--transition)",
  },
  menuBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
  },
  dropdown: {
    position: "absolute",
    top: "calc(var(--topbar-height) - 4px)",
    right: "12px",
    zIndex: 201,
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
    minWidth: "160px",
  },
  dropdownItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "11px 16px",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background-color var(--transition)",
  },
  dropdownItemDanger: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "11px 16px",
    fontSize: "0.875rem",
    color: "#DC2626",
    cursor: "pointer",
    textAlign: "left",
    transition: "background-color var(--transition)",
    borderTop: "1px solid var(--border)",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    zIndex: 300,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  modal: {
    backgroundColor: "var(--bg-primary)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border)",
    width: "100%",
    maxWidth: "340px",
    padding: "24px",
    boxShadow: "var(--shadow-lg)",
  },
  modalTitle: {
    fontSize: "1rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    marginBottom: "8px",
  },
  modalBody: {
    fontSize: "0.875rem",
    color: "var(--text-secondary)",
    lineHeight: "1.5",
    marginBottom: "16px",
  },
  memberList: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    marginBottom: "20px",
  },
  memberRow: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    textAlign: "left",
    transition: "background-color var(--transition)",
    backgroundColor: "transparent",
    border: "1px solid transparent",
  },
  memberRowSelected: {
    backgroundColor: "var(--active-bg)",
    border: "1px solid rgba(15, 110, 86, 0.3)",
  },
  memberAvatar: {
    width: "30px",
    height: "30px",
    borderRadius: "var(--radius-full)",
    flexShrink: 0,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: "0.75rem",
    fontWeight: "600",
    color: "#fff",
  },
  memberName: {
    flex: 1,
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
  checkIcon: {
    flexShrink: 0,
  },
  renameInput: {
    width: "100%",
    height: "40px",
    padding: "0 12px",
    fontSize: "0.9375rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    caretColor: "var(--accent)",
    marginBottom: "20px",
    WebkitAppearance: "none",
  },
  modalActions: {
    display: "flex",
    gap: "10px",
    justifyContent: "flex-end",
  },
  cancelButton: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "opacity var(--transition)",
  },
  addButton: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#ffffff",
    backgroundColor: "var(--accent)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "opacity var(--transition)",
  },
  addButtonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  deleteButton: {
    padding: "8px 16px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#ffffff",
    backgroundColor: "#DC2626",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "opacity var(--transition)",
  },
};
