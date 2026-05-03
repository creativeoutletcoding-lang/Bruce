"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserSummary } from "@/lib/types";

interface FamilyThreadTopBarProps {
  threadId: string;
  threadName: string;
  allMembers: UserSummary[];
  threadMemberIds: string[];
}

export default function FamilyThreadTopBar({
  threadId,
  threadName,
  allMembers,
  threadMemberIds,
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

  const threadMembers = allMembers.filter((m) => currentMemberIds.includes(m.id));
  const addableMembers = allMembers.filter((m) => !currentMemberIds.includes(m.id));

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await fetch(`/api/family/threads/${threadId}`, { method: "DELETE" });
      router.push("/family");
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

  return (
    <>
      <div style={styles.bar}>
        {/* Back to family */}
        <button
          onClick={() => router.push("/family")}
          style={styles.backButton}
          aria-label="Back to Family"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path
              d="M11 4L5 9l6 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Title */}
        <div style={styles.titleGroup}>
          <h1 style={styles.title}>{threadName}</h1>
        </div>

        {/* Member avatar stack — tap to open member list */}
        {threadMembers.length > 0 && (
          <button
            onClick={() => setMemberSheetOpen(true)}
            style={styles.avatarStackButton}
            aria-label="View members"
          >
            {threadMembers.slice(0, 3).map((m, i) => {
              console.log('avatar rendering, color_hex:', m.color_hex);
              return (
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
                    backgroundColor: m.color_hex,
                    flexShrink: 0,
                  }}
                >
                  {m.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.avatar_url}
                      alt=""
                      referrerPolicy="no-referrer"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
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
                  )}
                </div>
              );
            })}
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

        {/* Menu button */}
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

        {/* Dropdown */}
        {menuOpen && (
          <>
            <div style={styles.menuBackdrop} onClick={() => setMenuOpen(false)} />
            <div style={styles.dropdown}>
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
                  {addableMembers.map((member) => {
                    console.log('avatar rendering, color_hex:', member.color_hex);
                    return (
                    <button
                      key={member.id}
                      style={{
                        ...styles.memberRow,
                        ...(selectedUserId === member.id ? styles.memberRowSelected : {}),
                      }}
                      onClick={() => setSelectedUserId(member.id)}
                    >
                      <div style={{ ...styles.memberAvatar, backgroundColor: member.color_hex }}>
                        {member.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={member.avatar_url} alt="" style={styles.avatarImg} referrerPolicy="no-referrer" />
                        ) : (
                          <span style={{ ...styles.avatarInitial, color: "#fff" }}>{member.name.charAt(0)}</span>
                        )}
                      </div>
                      <span style={styles.memberName}>{member.name.split(" ")[0]}</span>
                      {selectedUserId === member.id && (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={styles.checkIcon} aria-hidden="true">
                          <path d="M3 8l4 4 6-7" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </button>
                  ); })}
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

      {/* Member sheet */}
      {memberSheetOpen && (
        <div style={styles.overlay} onClick={() => setMemberSheetOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <p style={styles.modalTitle}>Members</p>
            <div style={styles.memberList}>
              {threadMembers.map((m) => {
                console.log('avatar rendering, color_hex:', m.color_hex);
                return (
                  <div key={m.id} style={styles.memberRow}>
                    <div style={{ ...styles.memberAvatar, backgroundColor: m.color_hex }}>
                      {m.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.avatar_url} alt="" style={styles.avatarImg} referrerPolicy="no-referrer" />
                      ) : (
                        <span style={{ ...styles.avatarInitial, color: "#fff" }}>{m.name.charAt(0)}</span>
                      )}
                    </div>
                    <span style={styles.memberName}>{m.name}</span>
                  </div>
                );
              })}
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
            <p style={styles.modalTitle}>Delete &ldquo;{threadName}&rdquo;?</p>
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
  bar: {
    height: "var(--topbar-height)",
    display: "flex",
    alignItems: "center",
    padding: "0 12px",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--bg-primary)",
    flexShrink: 0,
    gap: "4px",
    position: "relative",
  },
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
  titleGroup: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
    backgroundColor: "rgba(15, 110, 86, 0.08)",
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
  avatarImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
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
