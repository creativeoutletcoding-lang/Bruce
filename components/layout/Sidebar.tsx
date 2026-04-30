"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useChatContext } from "@/components/layout/ChatShell";
import type { User, ProjectListItem, UserSummary } from "@/lib/types";

interface ThreadMemberSummary {
  id: string;
  name: string;
  avatar_url: string | null;
}

interface FamilyThread {
  id: string;
  title: string;
  last_message_at: string;
  unreadCount: number;
  members: ThreadMemberSummary[];
}

interface FamilyGroupInfo {
  id: string;
  unreadCount: number;
}

interface ChatListItem {
  id: string;
  title: string | null;
  type: string;
  last_message_at: string;
  last_message_content?: string;
  last_message_role?: string;
  project_id?: string | null;
}

interface SidebarProps {
  user: User;
  onNavigate: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ICON_OPTIONS = ["📁", "💼", "🏠", "🐾", "💰", "📋"];

function ThreadAvatarStack({ members }: { members: ThreadMemberSummary[] }) {
  const shown = members.slice(0, 3);
  const overflow = members.length - shown.length;
  return (
    <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
      {shown.map((m, i) => (
        <div
          key={m.id}
          style={{
            position: "relative",
            width: 18,
            height: 18,
            borderRadius: "var(--radius-full)",
            border: "1.5px solid var(--bg-sidebar)",
            overflow: "hidden",
            marginLeft: i === 0 ? 0 : -5,
            zIndex: shown.length - i,
            backgroundColor: "var(--accent)",
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
                fontSize: "0.45rem",
                fontWeight: "700",
                color: "#fff",
              }}
            >
              {m.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: "var(--radius-full)",
            border: "1.5px solid var(--bg-sidebar)",
            backgroundColor: "var(--bg-secondary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginLeft: -5,
            flexShrink: 0,
            fontSize: "0.45rem",
            fontWeight: "700",
            color: "var(--text-secondary)",
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      style={{
        width: 14,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#ffffff",
        flexShrink: 0,
      }}
    />
  );
}

export default function Sidebar({ user, onNavigate }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { registerRefresh } = useChatContext();
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [familyThreads, setFamilyThreads] = useState<FamilyThread[]>([]);
  const [familyGroup, setFamilyGroup] = useState<FamilyGroupInfo | null>(null);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectIcon, setNewProjectIcon] = useState("📁");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectErrorMsg, setProjectErrorMsg] = useState("");
  const [showNewThreadModal, setShowNewThreadModal] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [threadErrorMsg, setThreadErrorMsg] = useState("");
  const [householdMembers, setHouseholdMembers] = useState<UserSummary[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const supabase = createClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarTouchStartY = useRef<number>(-1);
  const [sidebarRefreshState, setSidebarRefreshState] = useState<"idle" | "pulling" | "refreshing">("idle");

  const activeChatId = pathname.startsWith("/chat/")
    ? pathname.split("/chat/")[1]
    : null;

  const activeProjectId = pathname.startsWith("/projects/")
    ? pathname.split("/projects/")[1]?.split("/")[0]
    : null;

  const isFamilyActive = pathname === "/family";
  const activeThreadId = pathname.startsWith("/family/threads/")
    ? pathname.split("/family/threads/")[1]?.split("/")[0]
    : null;

  const loadChats = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("chats")
      .select(`id, title, type, project_id, last_message_at, messages (content, role, created_at)`)
      .is("project_id", null)
      .neq("type", "incognito")
      .neq("type", "family_group")
      .neq("type", "family_thread")
      .order("last_message_at", { ascending: false });

    if (!data) return;

    const enriched: ChatListItem[] = data
      .filter((chat) => chat.project_id == null)
      .map((chat) => {
        const msgs = (chat.messages as Array<{ content: string; role: string; created_at: string }>) ?? [];
        const sorted = [...msgs].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const last = sorted[0];
        return {
          id: chat.id as string,
          title: chat.title as string | null,
          type: chat.type as string,
          project_id: null,
          last_message_at: chat.last_message_at as string,
          last_message_content: last?.content,
          last_message_role: last?.role,
        };
      });

    setChats(enriched);
  }, []);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) {
      const data: ProjectListItem[] = await res.json();
      setProjects(data);
    }
  }, []);

  const loadFamilyThreads = useCallback(async () => {
    const res = await fetch("/api/family/threads", { cache: "no-store" });
    if (res.ok) {
      const data: { familyGroup: FamilyGroupInfo | null; threads: FamilyThread[] } =
        await res.json();
      setFamilyGroup(data.familyGroup);
      setFamilyThreads(data.threads);
    }
  }, []);

  useEffect(() => {
    registerRefresh(loadChats);
    loadChats();
    loadProjects();
    loadFamilyThreads();

    const existing = supabase.getChannels().find(c => c.topic === "realtime:chat-list");
    if (existing) supabase.removeChannel(existing);

    const channel = supabase
      .channel("chat-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chats" },
        () => { loadChats(); loadFamilyThreads(); }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => loadChats()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        () => loadFamilyThreads()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications" },
        () => loadFamilyThreads()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNewChat() {
    router.push("/chat");
    onNavigate();
  }

  function handleSelectChat(chat: ChatListItem) {
    if (chat.project_id) {
      router.push(`/projects/${chat.project_id}/chat/${chat.id}`);
    } else {
      router.push(`/chat/${chat.id}`);
    }
    onNavigate();
  }

  function handleSelectProject(projectId: string) {
    router.push(`/projects/${projectId}`);
    onNavigate();
  }

  async function handleCreateProject() {
    if (!newProjectName.trim() || isCreatingProject) return;
    setIsCreatingProject(true);
    setProjectErrorMsg("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim(), icon: newProjectIcon }),
      });
      if (res.ok) {
        const project = await res.json();
        setShowNewProjectModal(false);
        setNewProjectName("");
        setNewProjectIcon("📁");
        await loadProjects();
        router.push(`/projects/${project.id}`);
        onNavigate();
      } else {
        const body = await res.json().catch(() => ({}));
        setProjectErrorMsg((body as { error?: string }).error ?? "Failed to create project. Please try again.");
      }
    } catch {
      setProjectErrorMsg("Network error. Please try again.");
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function openNewThreadModal() {
    setThreadErrorMsg("");
    setShowNewThreadModal(true);
    if (householdMembers.length === 0) {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data: UserSummary[] = await res.json();
        setHouseholdMembers(data);
        setSelectedMemberIds(new Set(data.map((m) => m.id)));
      } else {
        setThreadErrorMsg("Couldn't load members. Please close and try again.");
      }
    } else {
      setSelectedMemberIds(new Set(householdMembers.map((m) => m.id)));
    }
  }

  function toggleThreadMember(id: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateThread() {
    if (!newThreadName.trim() || isCreatingThread) return;
    setIsCreatingThread(true);
    setThreadErrorMsg("");
    try {
      const res = await fetch("/api/family/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newThreadName.trim(),
          memberIds: Array.from(selectedMemberIds),
        }),
      });
      if (res.ok) {
        const thread: FamilyThread = await res.json();
        setShowNewThreadModal(false);
        setNewThreadName("");
        // Optimistically add the thread so the sidebar is up to date before
        // navigation. members is empty until loadFamilyThreads() syncs.
        setFamilyThreads((prev) => [{ ...thread, unreadCount: 0, members: [] }, ...prev]);
        router.push(`/family/threads/${thread.id}`);
        onNavigate();
        loadFamilyThreads();
      } else {
        setThreadErrorMsg("Failed to create group chat. Please try again.");
      }
    } catch {
      setThreadErrorMsg("Network error. Please try again.");
    } finally {
      setIsCreatingThread(false);
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  function handleSidebarTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if ((contentRef.current?.scrollTop ?? 1) === 0) {
      sidebarTouchStartY.current = e.touches[0].clientY;
    }
  }

  function handleSidebarTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (sidebarTouchStartY.current < 0) return;
    const dy = e.touches[0].clientY - sidebarTouchStartY.current;
    setSidebarRefreshState(dy >= 56 ? "pulling" : "idle");
  }

  async function handleSidebarTouchEnd() {
    if (sidebarRefreshState === "pulling") {
      sidebarTouchStartY.current = -1;
      setSidebarRefreshState("refreshing");
      await Promise.all([loadChats(), loadProjects(), loadFamilyThreads()]);
      setSidebarRefreshState("idle");
    } else {
      setSidebarRefreshState("idle");
      sidebarTouchStartY.current = -1;
    }
  }

  // Member pip colors based on accent with opacity
  function getMemberPipColor(index: number): string {
    const opacities = [1, 0.7, 0.45, 0.25];
    const opacity = opacities[index] ?? 0.2;
    return `rgba(15, 110, 86, ${opacity})`;
  }

  return (
    <div style={styles.sidebar}>
      {/* New chat button */}
      <div style={styles.header}>
        <button
          onClick={handleNewChat}
          style={styles.newChatButton}
          aria-label="New chat"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          New chat
        </button>
        <button
          onClick={() => { loadChats(); loadProjects(); loadFamilyThreads(); }}
          style={styles.sidebarRefreshButton}
          aria-label="Refresh"
          title="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M13 2v4h-4M2 13v-4h4M2.5 9a5.5 5.5 0 0 0 10 1.5M12.5 6A5.5 5.5 0 0 0 2.5 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div
        ref={contentRef}
        onTouchStart={handleSidebarTouchStart}
        onTouchMove={handleSidebarTouchMove}
        onTouchEnd={handleSidebarTouchEnd}
        style={styles.content}
      >
        {sidebarRefreshState !== "idle" && (
          <div style={styles.sidebarRefreshIndicator}>
            {sidebarRefreshState === "refreshing" ? "Refreshing…" : "Release to refresh"}
          </div>
        )}
        {/* Projects section */}
        <div style={styles.section}>
          <div style={styles.sectionHeaderRow}>
            <span style={styles.sectionLabel}>Projects</span>
            <button
              onClick={() => setShowNewProjectModal(true)}
              style={styles.sectionAddButton}
              aria-label="New project"
              title="New project"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {projects.length === 0 ? (
            <p style={styles.emptyState}>No projects yet</p>
          ) : (
            projects.map((project) => {
              const isActive = project.id === activeProjectId;
              return (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project.id)}
                  style={{
                    ...styles.projectItem,
                    ...(isActive ? styles.projectItemActive : {}),
                  }}
                >
                  <span style={styles.projectItemIcon}>{project.icon}</span>
                  <span style={styles.projectItemName}>{project.name}</span>
                  <div style={styles.memberPips}>
                    {Array.from({ length: Math.min(project.member_count, 4) }).map((_, i) => (
                      <div
                        key={i}
                        style={{
                          ...styles.memberPip,
                          backgroundColor: getMemberPipColor(i),
                        }}
                      />
                    ))}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Chats section */}
        <div style={styles.section}>
          <div style={styles.sectionLabel}>Chats</div>
          {chats.length === 0 ? (
            <p style={styles.emptyState}>No conversations yet</p>
          ) : (
            chats.map((chat) => {
              const isActive = chat.id === activeChatId;
              const preview = chat.last_message_content
                ? chat.last_message_content.substring(0, 60)
                : null;

              return (
                <button
                  key={chat.id}
                  onClick={() => handleSelectChat(chat)}
                  style={{
                    ...styles.chatItem,
                    ...(isActive ? styles.chatItemActive : {}),
                  }}
                >
                  <span style={styles.chatItemTitle}>
                    {chat.title ?? "Untitled"}
                  </span>
                  <div style={styles.chatItemMeta}>
                    {preview && (
                      <span style={styles.chatItemPreview}>{preview}</span>
                    )}
                    <span style={styles.chatItemTime}>
                      {formatRelativeTime(chat.last_message_at)}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Family section — permanent group chat + threads */}
        <div style={styles.familySection}>
          <div style={styles.sectionHeaderRow}>
            <span style={styles.sectionLabel}>Family</span>
            <button
              onClick={openNewThreadModal}
              style={styles.sectionAddButton}
              aria-label="New group chat"
              title="New group chat"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <button
            onClick={() => { router.push("/family"); onNavigate(); }}
            style={{
              ...styles.familyButton,
              ...(isFamilyActive ? styles.familyButtonActive : {}),
            }}
          >
            <span style={styles.familyEmoji}>🏠</span>
            <span style={styles.familyName}>Family Chat</span>
            {!isFamilyActive && (familyGroup?.unreadCount ?? 0) > 0 && (
              <UnreadDot count={familyGroup!.unreadCount} />
            )}
          </button>
          {familyThreads.map((thread) => {
            const isActive = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                onClick={() => { router.push(`/family/threads/${thread.id}`); onNavigate(); }}
                style={{
                  ...styles.threadItem,
                  ...(isActive ? styles.threadItemActive : {}),
                }}
              >
                <span style={styles.threadName}>{thread.title}</span>
                {thread.members.length > 0 && (
                  <ThreadAvatarStack members={thread.members} />
                )}
                {!isActive && thread.unreadCount > 0 && (
                  <UnreadDot count={thread.unreadCount} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* User profile */}
      <div style={styles.userSection}>
        <div style={styles.userInfo}>
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatar_url}
              alt=""
              style={styles.avatar}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div style={styles.avatarFallback}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <span style={styles.userName}>{user.name.split(" ")[0]}</span>
        </div>
        <div style={styles.userActions}>
          <button
            onClick={() => { router.push("/settings"); onNavigate(); }}
            style={styles.iconButton}
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button onClick={handleSignOut} style={styles.iconButton} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l3-3-3-3M13 8H6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* New Thread Modal */}
      {showNewThreadModal && (
        <div
          style={styles.modalOverlay}
          onClick={() => { setShowNewThreadModal(false); setNewThreadName(""); setThreadErrorMsg(""); }}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>New group chat</span>
              <button
                style={styles.modalClose}
                onClick={() => { setShowNewThreadModal(false); setNewThreadName(""); setThreadErrorMsg(""); }}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              <input
                type="text"
                placeholder="Group chat name"
                value={newThreadName}
                onChange={(e) => setNewThreadName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateThread(); }}
                style={styles.nameInput}
                autoFocus
              />

              {/* Member picker */}
              {householdMembers.length > 0 && (
                <div>
                  <p style={styles.memberPickerLabel}>Members</p>
                  <div style={styles.memberPickerList}>
                    {householdMembers.map((member) => {
                      const checked = selectedMemberIds.has(member.id);
                      return (
                        <button
                          key={member.id}
                          onClick={() => toggleThreadMember(member.id)}
                          style={{
                            ...styles.memberPickerRow,
                            ...(checked ? styles.memberPickerRowChecked : {}),
                          }}
                        >
                          <div style={styles.memberPickerCheck}>
                            {checked && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                                <path d="M1.5 5l2.5 2.5 4.5-5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <span style={styles.memberPickerName}>{member.name.split(" ")[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {threadErrorMsg && (
                <p style={styles.errorMsg}>{threadErrorMsg}</p>
              )}
              <button
                onClick={handleCreateThread}
                disabled={!newThreadName.trim() || isCreatingThread || selectedMemberIds.size === 0}
                style={{
                  ...styles.createButton,
                  ...(!newThreadName.trim() || isCreatingThread || selectedMemberIds.size === 0
                    ? styles.createButtonDisabled
                    : {}),
                }}
              >
                {isCreatingThread ? "Creating…" : "Create group chat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div
          style={styles.modalOverlay}
          onClick={() => { setShowNewProjectModal(false); setNewProjectName(""); setNewProjectIcon("📁"); setProjectErrorMsg(""); }}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>New project</span>
              <button
                style={styles.modalClose}
                onClick={() => { setShowNewProjectModal(false); setNewProjectName(""); setNewProjectIcon("📁"); setProjectErrorMsg(""); }}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              {/* Icon picker */}
              <div style={styles.iconPickerRow}>
                {ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon}
                    style={{
                      ...styles.iconOption,
                      ...(newProjectIcon === icon ? styles.iconOptionSelected : {}),
                    }}
                    onClick={() => setNewProjectIcon(icon)}
                  >
                    {icon}
                  </button>
                ))}
              </div>

              {/* Name input */}
              <input
                type="text"
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateProject(); }}
                style={styles.nameInput}
                autoFocus
              />

              {projectErrorMsg && (
                <p style={styles.errorMsg}>{projectErrorMsg}</p>
              )}
              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim() || isCreatingProject}
                style={{
                  ...styles.createButton,
                  ...(!newProjectName.trim() || isCreatingProject ? styles.createButtonDisabled : {}),
                }}
              >
                {isCreatingProject ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    padding: "12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  newChatButton: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "9px 12px",
    backgroundColor: "var(--accent)",
    color: "#fff",
    borderRadius: "var(--radius-md)",
    fontSize: "0.875rem",
    fontWeight: "500",
    cursor: "pointer",
    transition: "opacity var(--transition)",
  },
  sidebarRefreshButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "32px",
    height: "32px",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    flexShrink: 0,
    transition: "color var(--transition)",
    border: "1px solid var(--border)",
  },
  sidebarRefreshIndicator: {
    textAlign: "center" as const,
    padding: "8px",
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  content: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 6px",
    display: "flex",
    flexDirection: "column",
  },
  section: {
    marginBottom: "4px",
  },
  sectionHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px 6px",
  },
  sectionLabel: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
    padding: "4px 8px 6px",
  },
  sectionAddButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    transition: "color var(--transition)",
  },
  emptyState: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    padding: "4px 8px",
  },

  // Project items
  projectItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "7px 10px",
    borderRadius: "var(--radius-md)",
    textAlign: "left",
    cursor: "pointer",
    backgroundColor: "transparent",
    color: "var(--text-primary)",
    borderLeft: "2px solid transparent",
    transition: "background-color var(--transition)",
  },
  projectItemActive: {
    backgroundColor: "rgba(15, 110, 86, 0.08)",
    borderLeft: "2px solid var(--accent)",
    color: "var(--accent)",
  },
  projectItemIcon: {
    fontSize: "1rem",
    flexShrink: 0,
    lineHeight: 1,
  },
  projectItemName: {
    flex: 1,
    fontSize: "0.875rem",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  memberPips: {
    display: "flex",
    alignItems: "center",
    gap: "3px",
    flexShrink: 0,
  },
  memberPip: {
    width: "6px",
    height: "6px",
    borderRadius: "var(--radius-full)",
  },

  // Chat items
  chatItem: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color var(--transition)",
    backgroundColor: "transparent",
    color: "var(--text-primary)",
    borderLeft: "2px solid transparent",
  },
  chatItemActive: {
    backgroundColor: "rgba(15, 110, 86, 0.08)",
    borderLeft: "2px solid var(--accent)",
    color: "var(--accent)",
  },
  chatItemTitle: {
    fontSize: "0.875rem",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatItemMeta: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
  },
  chatItemPreview: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },
  chatItemTime: {
    fontSize: "0.6875rem",
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  familySection: {
    padding: "8px 6px",
    borderTop: "1px solid var(--border)",
    marginTop: "auto",
  },
  familyButton: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    backgroundColor: "transparent",
    color: "var(--text-primary)",
    borderLeft: "2px solid transparent",
    textAlign: "left",
    transition: "background-color var(--transition)",
  },
  familyButtonActive: {
    backgroundColor: "rgba(15, 110, 86, 0.08)",
    borderLeft: "2px solid var(--accent)",
    color: "var(--accent)",
  },
  familyEmoji: {
    fontSize: "1.125rem",
    lineHeight: 1,
    flexShrink: 0,
  },
  familyName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  threadItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    backgroundColor: "transparent",
    color: "var(--text-secondary)",
    borderLeft: "2px solid transparent",
    textAlign: "left",
    transition: "background-color var(--transition)",
  },
  threadItemActive: {
    backgroundColor: "rgba(15, 110, 86, 0.08)",
    borderLeft: "2px solid var(--accent)",
    color: "var(--accent)",
  },
  threadEmoji: {
    fontSize: "0.875rem",
    lineHeight: 1,
    flexShrink: 0,
  },
  threadName: {
    fontSize: "0.8125rem",
    fontWeight: "500",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
  },

  // User profile
  userSection: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  avatar: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    objectFit: "cover",
  },
  avatarFallback: {
    width: "28px",
    height: "28px",
    borderRadius: "var(--radius-full)",
    backgroundColor: "var(--accent)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: "600",
  },
  userName: {
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "var(--text-primary)",
  },
  userActions: {
    display: "flex",
    alignItems: "center",
    gap: "2px",
  },
  iconButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    transition: "color var(--transition), background-color var(--transition)",
  },

  // New project modal
  modalOverlay: {
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
    boxShadow: "var(--shadow-lg)",
    overflow: "hidden",
  },
  modalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
  },
  modalTitle: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
  },
  modalClose: {
    fontSize: "1.25rem",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    lineHeight: 1,
    padding: "2px 6px",
    borderRadius: "var(--radius-sm)",
  },
  modalBody: {
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  iconPickerRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  iconOption: {
    fontSize: "1.375rem",
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "var(--radius-md)",
    border: "2px solid transparent",
    cursor: "pointer",
    transition: "border-color var(--transition), background-color var(--transition)",
    backgroundColor: "var(--bg-secondary)",
  },
  iconOptionSelected: {
    borderColor: "var(--accent)",
    backgroundColor: "rgba(15, 110, 86, 0.08)",
  },
  nameInput: {
    width: "100%",
    padding: "10px 12px",
    fontSize: "0.875rem",
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-md)",
    outline: "none",
    fontFamily: "inherit",
  },
  createButton: {
    width: "100%",
    padding: "10px",
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#fff",
    backgroundColor: "var(--accent)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    transition: "opacity var(--transition)",
  },
  createButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  errorMsg: {
    fontSize: "0.8125rem",
    color: "#c0392b",
    margin: 0,
  },
  memberPickerLabel: {
    fontSize: "0.75rem",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    color: "var(--text-tertiary)",
    marginBottom: "6px",
  },
  memberPickerList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px",
    marginBottom: "4px",
  },
  memberPickerRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
    textAlign: "left" as const,
    backgroundColor: "transparent",
    transition: "background-color var(--transition)",
    color: "var(--text-primary)",
  },
  memberPickerRowChecked: {
    backgroundColor: "rgba(15, 110, 86, 0.06)",
  },
  memberPickerCheck: {
    width: "16px",
    height: "16px",
    borderRadius: "var(--radius-sm)",
    border: "1.5px solid var(--border-strong)",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--bg-secondary)",
  },
  memberPickerName: {
    fontSize: "0.875rem",
    fontWeight: "500",
  },
};
