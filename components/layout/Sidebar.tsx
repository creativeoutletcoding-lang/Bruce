"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useChatContext } from "@/components/layout/ChatShell";
import PullProgressBar from "@/components/ui/PullProgressBar";
import { lightHaptic } from "@/lib/utils/haptics";
import type { User, ProjectListItem, UserSummary } from "@/lib/types";

// ── Local interfaces ────────────────────────────────────────────────────────

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

interface ProjectChatListItem {
  id: string;
  title: string | null;
  last_message_at: string;
  owner_id: string;
  project_id: string;
  project_name: string;
  project_icon: string;
}

interface ContextMenuState {
  id: string;
  kind: "chat" | "thread" | "family_group";
  x: number;
  y: number;
}

interface SidebarProps {
  user: User;
  onNavigate: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

const ICON_OPTIONS = ["", "📁", "💼", "🏠", "🐾", "💰", "📋"];

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

// ── Component ────────────────────────────────────────────────────────────────

export default function Sidebar({ user, onNavigate }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { registerRefresh } = useChatContext();

  // ── data ────────────────────────────────────────────────────────────────
  const [chats, setChats] = useState<ChatListItem[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [familyThreads, setFamilyThreads] = useState<FamilyThread[]>([]);
  const [familyGroup, setFamilyGroup] = useState<FamilyGroupInfo | null>(null);

  // ── new project modal ────────────────────────────────────────────────────
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectIcon, setNewProjectIcon] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectErrorMsg, setProjectErrorMsg] = useState("");

  // ── new thread modal ─────────────────────────────────────────────────────
  const [showNewThreadModal, setShowNewThreadModal] = useState(false);
  const [newThreadName, setNewThreadName] = useState("");
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [threadErrorMsg, setThreadErrorMsg] = useState("");
  const [householdMembers, setHouseholdMembers] = useState<UserSummary[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());

  // ── standalone chats bulk delete (PATH 1) ────────────────────────────────
  const [chatsSelectMode, setChatsSelectMode] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  // ── projects bulk delete ─────────────────────────────────────────────────
  const [projectsSelectMode, setProjectsSelectMode] = useState(false);
  const [allProjectChats, setAllProjectChats] = useState<ProjectChatListItem[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [selectedProjectChatIds, setSelectedProjectChatIds] = useState<Set<string>>(new Set());
  const [showProjectBulkDeleteConfirm, setShowProjectBulkDeleteConfirm] = useState(false);
  const [isDeletingProjectChats, setIsDeletingProjectChats] = useState(false);
  const [loadingProjectChats, setLoadingProjectChats] = useState(false);

  // ── family threads bulk delete ───────────────────────────────────────────
  const [threadsSelectMode, setThreadsSelectMode] = useState(false);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const [showThreadBulkDeleteConfirm, setShowThreadBulkDeleteConfirm] = useState(false);
  const [isDeletingThreads, setIsDeletingThreads] = useState(false);

  // ── shared context menu + single delete ──────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [singleDeleteTarget, setSingleDeleteTarget] = useState<{ id: string; kind: "chat" | "thread" | "family_group" } | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressActiveRef = useRef(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // ── pull-to-refresh ──────────────────────────────────────────────────────
  const supabase = createClient();
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarTouchStartY = useRef<number>(-1);
  const [sidebarPullDistance, setSidebarPullDistance] = useState(0);
  const [sidebarIsRefreshing, setSidebarIsRefreshing] = useState(false);

  // ── section collapse ─────────────────────────────────────────────────────
  const [projectsExpanded, setProjectsExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("bruce_sidebar_projects");
    return v === null ? true : v === "true";
  });
  const [chatsExpanded, setChatsExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("bruce_sidebar_chats");
    return v === null ? true : v === "true";
  });
  const [familyExpanded, setFamilyExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    const v = localStorage.getItem("bruce_sidebar_family");
    return v === null ? true : v === "true";
  });

  // ── derived ──────────────────────────────────────────────────────────────
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

  // ── data loaders ─────────────────────────────────────────────────────────
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

  async function loadAllProjectChats(currentProjects: ProjectListItem[]) {
    setLoadingProjectChats(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("chats")
        .select("id, title, owner_id, last_message_at, project_id")
        .not("project_id", "is", null)
        .order("last_message_at", { ascending: false });

      if (!data) return;

      const items: ProjectChatListItem[] = data.map((c) => {
        const proj = currentProjects.find((p) => p.id === c.project_id);
        return {
          id: c.id as string,
          title: c.title as string | null,
          last_message_at: c.last_message_at as string,
          owner_id: c.owner_id as string,
          project_id: c.project_id as string,
          project_name: proj?.name ?? "Unknown project",
          project_icon: proj?.icon ?? "",
        };
      });

      setAllProjectChats(items);
    } finally {
      setLoadingProjectChats(false);
    }
  }

  // ── realtime subscription + initial load ─────────────────────────────────
  useEffect(() => {
    registerRefresh(loadChats);
    loadChats();
    loadProjects();
    loadFamilyThreads();

    const existing = supabase.getChannels().find(c => c.topic === "realtime:chat-list");
    if (existing) supabase.removeChannel(existing);

    const channel = supabase
      .channel("chat-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "chats" },
        () => { loadChats(); loadFamilyThreads(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" },
        () => loadChats())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" },
        () => loadFamilyThreads())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications" },
        () => loadFamilyThreads())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── context menu: outside-click/touch dismiss ────────────────────────────
  // Use mousedown+touchstart (more reliable than click) and check via ref so
  // interactions inside the menu itself never dismiss it.
  useEffect(() => {
    if (!contextMenu) return;
    function dismiss(e: Event) {
      if (contextMenuRef.current?.contains(e.target as Node)) return;
      setContextMenu(null);
    }
    // Delay so the event that opened the menu doesn't immediately close it.
    const timerId = setTimeout(() => {
      document.addEventListener("mousedown", dismiss);
      document.addEventListener("touchstart", dismiss, { passive: true });
    }, 0);
    return () => {
      clearTimeout(timerId);
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("touchstart", dismiss);
    };
  }, [contextMenu]);

  // ── section collapse ─────────────────────────────────────────────────────
  function toggleProjects() {
    setProjectsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("bruce_sidebar_projects", String(next));
      return next;
    });
  }

  function toggleChats() {
    setChatsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("bruce_sidebar_chats", String(next));
      return next;
    });
  }

  function toggleFamily() {
    setFamilyExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("bruce_sidebar_family", String(next));
      return next;
    });
  }

  // ── navigation ────────────────────────────────────────────────────────────
  function handleNewChat() {
    router.push("/chat");
    onNavigate();
  }

  function handleSelectChat(chat: ChatListItem) {
    if (longPressActiveRef.current) {
      longPressActiveRef.current = false;
      return;
    }
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

  // ── standalone chats: bulk delete ────────────────────────────────────────
  function enterChatsSelectMode() {
    setContextMenu(null);
    setProjectsSelectMode(false);
    setThreadsSelectMode(false);
    setSelectedThreadIds(new Set());
    setSelectedChatIds(new Set());
    setChatsSelectMode(true);
    if (!chatsExpanded) {
      setChatsExpanded(true);
      localStorage.setItem("bruce_sidebar_chats", "true");
    }
  }

  function exitChatsSelectMode() {
    setChatsSelectMode(false);
    setSelectedChatIds(new Set());
  }

  function toggleChatSelection(id: string) {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    if (isDeletingBulk || selectedChatIds.size === 0) return;
    setIsDeletingBulk(true);
    try {
      const ids = Array.from(selectedChatIds);
      const res = await fetch("/api/chats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const deletedActive = activeChatId && selectedChatIds.has(activeChatId);
        setShowBulkDeleteConfirm(false);
        exitChatsSelectMode();
        await loadChats();
        if (deletedActive) {
          router.push("/chat");
          onNavigate();
        }
      }
    } finally {
      setIsDeletingBulk(false);
    }
  }

  // ── projects: bulk delete ────────────────────────────────────────────────
  function enterProjectsSelectMode() {
    setContextMenu(null);
    setChatsSelectMode(false);
    setThreadsSelectMode(false);
    setSelectedThreadIds(new Set());
    setSelectedProjectIds(new Set());
    setSelectedProjectChatIds(new Set());
    setProjectsSelectMode(true);
    setAllProjectChats([]);
    loadAllProjectChats(projects);
    if (!projectsExpanded) {
      setProjectsExpanded(true);
      localStorage.setItem("bruce_sidebar_projects", "true");
    }
  }

  function exitProjectsSelectMode() {
    setProjectsSelectMode(false);
    setSelectedProjectIds(new Set());
    setSelectedProjectChatIds(new Set());
    setAllProjectChats([]);
  }

  function toggleProjectSelection(id: string, isOwned: boolean) {
    if (!isOwned) return;
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProjectChatSelection(id: string, isOwned: boolean) {
    if (!isOwned) return;
    setSelectedProjectChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleProjectBulkDelete() {
    if (isDeletingProjectChats) return;
    if (selectedProjectIds.size === 0 && selectedProjectChatIds.size === 0) return;
    setIsDeletingProjectChats(true);
    try {
      // Delete whole projects (FK cascades handle chats/messages/files/members)
      if (selectedProjectIds.size > 0) {
        const res = await fetch("/api/projects", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: Array.from(selectedProjectIds) }),
        });
        if (!res.ok) throw new Error("Failed to delete projects");
      }

      // Delete individual chats that are NOT inside a project being deleted
      const chatIdsToDelete = Array.from(selectedProjectChatIds).filter((chatId) => {
        const chat = allProjectChats.find((c) => c.id === chatId);
        return chat && !selectedProjectIds.has(chat.project_id);
      });
      if (chatIdsToDelete.length > 0) {
        const res = await fetch("/api/chats", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chatIdsToDelete }),
        });
        if (!res.ok) throw new Error("Failed to delete chats");
      }

      // Navigate away from deleted context
      const projMatch = pathname.match(/^\/projects\/([^/]+)/);
      if (projMatch) {
        const currentProjectId = projMatch[1];
        if (selectedProjectIds.has(currentProjectId)) {
          router.push("/chat");
          onNavigate();
        } else {
          const chatMatch = pathname.match(/^\/projects\/[^/]+\/chat\/([^/]+)/);
          if (chatMatch && selectedProjectChatIds.has(chatMatch[1])) {
            router.push(`/projects/${currentProjectId}`);
            onNavigate();
          }
        }
      }

      setShowProjectBulkDeleteConfirm(false);
      exitProjectsSelectMode();
      await loadProjects();
    } catch (err) {
      console.error("[Sidebar] Bulk delete failed:", err);
    } finally {
      setIsDeletingProjectChats(false);
    }
  }

  // ── family threads: bulk delete ──────────────────────────────────────────
  function enterThreadsSelectMode() {
    setContextMenu(null);
    setChatsSelectMode(false);
    setSelectedChatIds(new Set());
    setProjectsSelectMode(false);
    setSelectedProjectIds(new Set());
    setSelectedProjectChatIds(new Set());
    setSelectedThreadIds(new Set());
    setThreadsSelectMode(true);
    if (!familyExpanded) {
      setFamilyExpanded(true);
      localStorage.setItem("bruce_sidebar_family", "true");
    }
  }

  function exitThreadsSelectMode() {
    setThreadsSelectMode(false);
    setSelectedThreadIds(new Set());
  }

  function toggleThreadSelection(id: string) {
    setSelectedThreadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleThreadBulkDelete() {
    if (isDeletingThreads || selectedThreadIds.size === 0) return;
    setIsDeletingThreads(true);
    try {
      const ids = Array.from(selectedThreadIds);
      const res = await fetch("/api/chats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        const deletedActive = activeThreadId && selectedThreadIds.has(activeThreadId);
        setShowThreadBulkDeleteConfirm(false);
        exitThreadsSelectMode();
        await loadFamilyThreads();
        if (deletedActive) {
          router.push("/family");
          onNavigate();
        }
      }
    } finally {
      setIsDeletingThreads(false);
    }
  }

  // ── shared context menu: right-click + long press ────────────────────────
  function handleItemRightClick(e: React.MouseEvent, id: string, kind: "chat" | "thread" | "family_group") {
    if (kind === "chat" && chatsSelectMode) return;
    if (kind === "thread" && threadsSelectMode) return;
    e.preventDefault();
    setContextMenu({ id, kind, x: e.clientX, y: e.clientY });
  }

  function handleItemLongPressStart(e: React.TouchEvent, id: string, kind: "chat" | "thread" | "family_group") {
    if (kind === "chat" && chatsSelectMode) return;
    if (kind === "thread" && threadsSelectMode) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimerRef.current = setTimeout(() => {
      lightHaptic();
      longPressActiveRef.current = true;
      setContextMenu({ id, kind, x, y });
      longPressTimerRef.current = null;
    }, 500);
  }

  function handleItemLongPressEnd(e: React.TouchEvent) {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (longPressActiveRef.current) {
      e.preventDefault();
    }
  }

  function handleItemLongPressMove() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  // ── shared single delete ─────────────────────────────────────────────────
  async function handleSingleDelete() {
    if (!singleDeleteTarget || isDeletingSingle) return;
    setIsDeletingSingle(true);
    try {
      const res = await fetch("/api/chats", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [singleDeleteTarget.id] }),
      });
      if (res.ok) {
        const { id, kind } = singleDeleteTarget;
        setSingleDeleteTarget(null);

        if (kind === "chat") {
          const deletedActive = activeChatId === id;
          await loadChats();
          if (deletedActive) {
            router.push("/chat");
            onNavigate();
          }
        } else if (kind === "family_group") {
          await loadFamilyThreads();
          if (isFamilyActive) {
            router.push("/chat");
            onNavigate();
          }
        } else {
          // thread
          await loadFamilyThreads();
          if (activeThreadId === id) {
            router.push("/family");
            onNavigate();
          }
        }
      }
    } finally {
      setIsDeletingSingle(false);
    }
  }

  // ── project creation ─────────────────────────────────────────────────────
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
        setNewProjectIcon("");
        await loadProjects();
        router.push(`/projects/${project.id}`);
        onNavigate();
      } else {
        const body = await res.json().catch(() => ({}));
        setProjectErrorMsg((body as { error?: string }).error ?? "Failed to create project.");
      }
    } catch {
      setProjectErrorMsg("Network error. Please try again.");
    } finally {
      setIsCreatingProject(false);
    }
  }

  // ── thread creation ──────────────────────────────────────────────────────
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

  // ── pull-to-refresh ──────────────────────────────────────────────────────
  function handleSidebarTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if ((contentRef.current?.scrollTop ?? 1) === 0) {
      sidebarTouchStartY.current = e.touches[0].clientY;
    }
  }

  function handleSidebarTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (sidebarTouchStartY.current < 0) return;
    const dy = Math.max(0, e.touches[0].clientY - sidebarTouchStartY.current);
    setSidebarPullDistance(dy);
  }

  async function handleSidebarTouchEnd() {
    if (sidebarPullDistance >= 56) {
      sidebarTouchStartY.current = -1;
      setSidebarPullDistance(0);
      setSidebarIsRefreshing(true);
      lightHaptic();
      await Promise.all([loadChats(), loadProjects(), loadFamilyThreads()]);
      setSidebarIsRefreshing(false);
    } else {
      setSidebarPullDistance(0);
      sidebarTouchStartY.current = -1;
    }
  }

  function getMemberPipColor(index: number): string {
    const opacities = [1, 0.7, 0.45, 0.25];
    const opacity = opacities[index] ?? 0.2;
    return `rgba(15, 110, 86, ${opacity})`;
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={styles.sidebar}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={handleNewChat} style={styles.newChatButton} aria-label="New chat">
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

      <div style={styles.contentWrapper}>
        <PullProgressBar pullProgress={Math.min(sidebarPullDistance / 56, 1)} refreshing={sidebarIsRefreshing} />
        <div
          ref={contentRef}
          onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove}
          onTouchEnd={handleSidebarTouchEnd}
          style={styles.content}
        >
          {/* ── Projects section ─────────────────────────────────────────── */}
          <div style={styles.section}>
            <div style={styles.sectionHeaderRow}>
              <span
                style={{ ...styles.sectionLabel, cursor: projectsSelectMode ? "default" : "pointer", flex: 1 }}
                onClick={projectsSelectMode ? undefined : toggleProjects}
                role={projectsSelectMode ? undefined : "button"}
                aria-expanded={projectsSelectMode ? undefined : projectsExpanded}
              >
                Projects
              </span>
              {projectsSelectMode ? (
                <button onClick={exitProjectsSelectMode} style={styles.sectionEditButton}>Done</button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {projects.length > 0 && (
                    <button
                      onClick={enterProjectsSelectMode}
                      style={styles.sectionEditButton}
                      aria-label="Select project chats"
                      title="Select project chats"
                    >
                      Edit
                    </button>
                  )}
                  <svg
                    width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"
                    onClick={toggleProjects}
                    style={{ transform: projectsExpanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform var(--transition)", color: "var(--text-tertiary)", flexShrink: 0, cursor: "pointer" }}
                  >
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowNewProjectModal(true); }}
                    style={styles.sectionAddButton}
                    aria-label="New project"
                    title="New project"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {projectsSelectMode ? (
              // Edit mode: project rows (with checkboxes) + their chats underneath
              <>
                {projects.map((project) => {
                  const isOwnedProject = project.owner_id === user.id;
                  const isProjectSelected = selectedProjectIds.has(project.id);
                  const projectChats = allProjectChats.filter((c) => c.project_id === project.id);
                  return (
                    <div key={project.id}>
                      {/* Project row */}
                      <button
                        onClick={() => toggleProjectSelection(project.id, isOwnedProject)}
                        style={{
                          ...styles.chatItem,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: "8px",
                          ...(isProjectSelected ? styles.chatItemSelected : {}),
                          ...(!isOwnedProject ? { opacity: 0.45, cursor: "default" } : {}),
                        }}
                      >
                        <div style={{
                          ...styles.chatSelectCircle,
                          ...(isProjectSelected ? { backgroundColor: "var(--accent)", borderColor: "var(--accent)" } : {}),
                          ...(!isOwnedProject ? { borderStyle: "dashed" } : {}),
                        }}>
                          {isProjectSelected && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                              <path d="M1.5 5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        {project.icon && <span style={{ fontSize: "0.9375rem", flexShrink: 0 }}>{project.icon}</span>}
                        <span style={{ ...styles.chatItemTitle, fontWeight: "600" }}>{project.name}</span>
                      </button>

                      {/* Chat rows for this project */}
                      {!loadingProjectChats && projectChats.map((chat) => {
                        const isOwned = chat.owner_id === user.id;
                        const isSelected = selectedProjectChatIds.has(chat.id);
                        return (
                          <button
                            key={chat.id}
                            onClick={() => toggleProjectChatSelection(chat.id, isOwned)}
                            style={{
                              ...styles.chatItem,
                              flexDirection: "row",
                              alignItems: "center",
                              gap: "8px",
                              paddingLeft: "20px",
                              ...(isSelected ? styles.chatItemSelected : {}),
                              ...(!isOwned ? { opacity: 0.45, cursor: "default" } : {}),
                            }}
                          >
                            <div style={{
                              ...styles.chatSelectCircle,
                              ...(isSelected ? { backgroundColor: "var(--accent)", borderColor: "var(--accent)" } : {}),
                              ...(!isOwned ? { borderStyle: "dashed" } : {}),
                            }}>
                              {isSelected && (
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                                  <path d="M1.5 5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={styles.chatItemTitle}>{chat.title ?? "Untitled"}</div>
                              <div style={styles.chatItemMeta}>
                                <span style={styles.chatItemTime}>{formatRelativeTime(chat.last_message_at)}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {loadingProjectChats && <p style={styles.emptyState}>Loading chats…</p>}
                {(() => {
                  const hasSelection = selectedProjectIds.size > 0 || selectedProjectChatIds.size > 0;
                  let label = "Select items to delete";
                  if (selectedProjectIds.size > 0 && selectedProjectChatIds.size > 0) {
                    label = `Delete ${selectedProjectIds.size} ${selectedProjectIds.size === 1 ? "project" : "projects"} and ${selectedProjectChatIds.size} ${selectedProjectChatIds.size === 1 ? "chat" : "chats"}`;
                  } else if (selectedProjectIds.size > 0) {
                    label = `Delete ${selectedProjectIds.size} ${selectedProjectIds.size === 1 ? "project" : "projects"}`;
                  } else if (selectedProjectChatIds.size > 0) {
                    label = `Delete ${selectedProjectChatIds.size} ${selectedProjectChatIds.size === 1 ? "chat" : "chats"}`;
                  }
                  return (
                    <button
                      onClick={() => { if (hasSelection) setShowProjectBulkDeleteConfirm(true); }}
                      disabled={!hasSelection}
                      style={{
                        ...styles.deleteSelectedButton,
                        ...(!hasSelection ? styles.deleteSelectedButtonDisabled : {}),
                      }}
                    >
                      {label}
                    </button>
                  );
                })()}
              </>
            ) : (
              projectsExpanded && (projects.length === 0 ? (
                <p style={styles.emptyState}>No projects yet</p>
              ) : (
                projects.map((project) => {
                  const isActive = project.id === activeProjectId;
                  return (
                    <button
                      key={project.id}
                      onClick={() => handleSelectProject(project.id)}
                      style={{ ...styles.projectItem, ...(isActive ? styles.projectItemActive : {}) }}
                    >
                      {project.icon && <span style={styles.projectItemIcon}>{project.icon}</span>}
                      <span style={styles.projectItemName}>{project.name}</span>
                      <div style={styles.memberPips}>
                        {Array.from({ length: Math.min(project.member_count, 4) }).map((_, i) => (
                          <div key={i} style={{ ...styles.memberPip, backgroundColor: getMemberPipColor(i) }} />
                        ))}
                      </div>
                    </button>
                  );
                })
              ))
            )}
          </div>

          {/* ── Chats section ────────────────────────────────────────────── */}
          <div style={styles.section}>
            <div style={styles.sectionHeaderRow}>
              <span
                style={{ ...styles.sectionLabel, cursor: "pointer", flex: 1 }}
                onClick={toggleChats}
                role="button"
                aria-expanded={chatsExpanded}
              >
                Chats
              </span>
              {chatsSelectMode ? (
                <button onClick={exitChatsSelectMode} style={styles.sectionEditButton}>Done</button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {chats.length > 0 && (
                    <button
                      onClick={enterChatsSelectMode}
                      style={styles.sectionEditButton}
                      aria-label="Select chats"
                      title="Select chats"
                    >
                      Edit
                    </button>
                  )}
                  <svg
                    width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"
                    onClick={toggleChats}
                    style={{ transform: chatsExpanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform var(--transition)", color: "var(--text-tertiary)", flexShrink: 0, cursor: "pointer" }}
                  >
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>

            {chatsExpanded && (chats.length === 0 ? (
              <p style={styles.emptyState}>No conversations yet</p>
            ) : (
              <>
                {chats.map((chat) => {
                  const isActive = chat.id === activeChatId;
                  const isSelected = selectedChatIds.has(chat.id);
                  const preview = chat.last_message_content
                    ? chat.last_message_content.substring(0, 60)
                    : null;

                  if (chatsSelectMode) {
                    return (
                      <button
                        key={chat.id}
                        onClick={() => toggleChatSelection(chat.id)}
                        style={{
                          ...styles.chatItem,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: "8px",
                          ...(isSelected ? styles.chatItemSelected : {}),
                        }}
                      >
                        <div style={{
                          ...styles.chatSelectCircle,
                          ...(isSelected ? { backgroundColor: "var(--accent)", borderColor: "var(--accent)" } : {}),
                        }}>
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                              <path d="M1.5 5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={styles.chatItemTitle}>{chat.title ?? "Untitled"}</div>
                          <div style={styles.chatItemMeta}>
                            {preview && <span style={styles.chatItemPreview}>{preview}</span>}
                            <span style={styles.chatItemTime}>{formatRelativeTime(chat.last_message_at)}</span>
                          </div>
                        </div>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={chat.id}
                      onClick={() => handleSelectChat(chat)}
                      onContextMenu={(e) => handleItemRightClick(e, chat.id, "chat")}
                      onTouchStart={(e) => handleItemLongPressStart(e, chat.id, "chat")}
                      onTouchEnd={handleItemLongPressEnd}
                      onTouchMove={handleItemLongPressMove}
                      style={{ ...styles.chatItem, ...(isActive ? styles.chatItemActive : {}) }}
                    >
                      <div style={styles.chatItemTitle}>{chat.title ?? "Untitled"}</div>
                      <div style={styles.chatItemMeta}>
                        {preview && <span style={styles.chatItemPreview}>{preview}</span>}
                        <span style={styles.chatItemTime}>{formatRelativeTime(chat.last_message_at)}</span>
                      </div>
                    </button>
                  );
                })}

                {chatsSelectMode && (
                  <button
                    onClick={() => { if (selectedChatIds.size > 0) setShowBulkDeleteConfirm(true); }}
                    disabled={selectedChatIds.size === 0}
                    style={{
                      ...styles.deleteSelectedButton,
                      ...(selectedChatIds.size === 0 ? styles.deleteSelectedButtonDisabled : {}),
                    }}
                  >
                    {selectedChatIds.size === 0
                      ? "Select chats to delete"
                      : `Delete ${selectedChatIds.size} ${selectedChatIds.size === 1 ? "chat" : "chats"}`}
                  </button>
                )}
              </>
            ))}
          </div>

          {/* ── Family section ───────────────────────────────────────────── */}
          <div style={styles.familySection}>
            <div style={styles.sectionHeaderRow}>
              <span
                style={{ ...styles.sectionLabel, cursor: threadsSelectMode ? "default" : "pointer", flex: 1 }}
                onClick={threadsSelectMode ? undefined : toggleFamily}
                role={threadsSelectMode ? undefined : "button"}
                aria-expanded={threadsSelectMode ? undefined : familyExpanded}
              >
                Family
              </span>
              {threadsSelectMode ? (
                <button onClick={exitThreadsSelectMode} style={styles.sectionEditButton}>Done</button>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  {familyThreads.length > 0 && (
                    <button
                      onClick={enterThreadsSelectMode}
                      style={styles.sectionEditButton}
                      aria-label="Select threads"
                      title="Select threads"
                    >
                      Edit
                    </button>
                  )}
                  <svg
                    width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"
                    onClick={toggleFamily}
                    style={{ transform: familyExpanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform var(--transition)", color: "var(--text-tertiary)", flexShrink: 0, cursor: "pointer" }}
                  >
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <button
                    onClick={(e) => { e.stopPropagation(); openNewThreadModal(); }}
                    style={styles.sectionAddButton}
                    aria-label="New group chat"
                    title="New group chat"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {familyExpanded && (
              <>
                {/* Family group chat — only rendered when a family_group chat exists */}
                {familyGroup && (
                  <button
                    onClick={() => {
                      if (longPressActiveRef.current) { longPressActiveRef.current = false; return; }
                      router.push("/family");
                      onNavigate();
                    }}
                    onContextMenu={(e) => handleItemRightClick(e, familyGroup.id, "family_group")}
                    onTouchStart={(e) => handleItemLongPressStart(e, familyGroup.id, "family_group")}
                    onTouchEnd={handleItemLongPressEnd}
                    onTouchMove={handleItemLongPressMove}
                    style={{ ...styles.familyButton, ...(isFamilyActive ? styles.familyButtonActive : {}) }}
                  >
                    <span style={styles.familyEmoji}>🏠</span>
                    <span style={styles.familyName}>Family Chat</span>
                    {!isFamilyActive && familyGroup.unreadCount > 0 && (
                      <UnreadDot count={familyGroup.unreadCount} />
                    )}
                  </button>
                )}

                {/* Family threads */}
                {familyThreads.map((thread) => {
                  const isActive = thread.id === activeThreadId;
                  const isSelected = selectedThreadIds.has(thread.id);

                  if (threadsSelectMode) {
                    return (
                      <button
                        key={thread.id}
                        onClick={() => toggleThreadSelection(thread.id)}
                        style={{
                          ...styles.threadItem,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: "8px",
                          ...(isSelected ? styles.chatItemSelected : {}),
                        }}
                      >
                        <div style={{
                          ...styles.chatSelectCircle,
                          ...(isSelected ? { backgroundColor: "var(--accent)", borderColor: "var(--accent)" } : {}),
                        }}>
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                              <path d="M1.5 5l2.5 2.5 4.5-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <span style={styles.threadName}>{thread.title}</span>
                      </button>
                    );
                  }

                  return (
                    <button
                      key={thread.id}
                      onClick={() => {
                        if (longPressActiveRef.current) {
                          longPressActiveRef.current = false;
                          return;
                        }
                        router.push(`/family/threads/${thread.id}`);
                        onNavigate();
                      }}
                      onContextMenu={(e) => handleItemRightClick(e, thread.id, "thread")}
                      onTouchStart={(e) => handleItemLongPressStart(e, thread.id, "thread")}
                      onTouchEnd={handleItemLongPressEnd}
                      onTouchMove={handleItemLongPressMove}
                      style={{ ...styles.threadItem, ...(isActive ? styles.threadItemActive : {}) }}
                    >
                      <span style={styles.threadName}>{thread.title}</span>
                      {thread.members.length > 0 && <ThreadAvatarStack members={thread.members} />}
                      {!isActive && thread.unreadCount > 0 && <UnreadDot count={thread.unreadCount} />}
                    </button>
                  );
                })}

                {threadsSelectMode && (
                  <button
                    onClick={() => { if (selectedThreadIds.size > 0) setShowThreadBulkDeleteConfirm(true); }}
                    disabled={selectedThreadIds.size === 0}
                    style={{
                      ...styles.deleteSelectedButton,
                      ...(selectedThreadIds.size === 0 ? styles.deleteSelectedButtonDisabled : {}),
                    }}
                  >
                    {selectedThreadIds.size === 0
                      ? "Select chats to delete"
                      : `Delete ${selectedThreadIds.size} ${selectedThreadIds.size === 1 ? "chat" : "chats"}`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* User profile */}
      <div style={styles.userSection}>
        <div style={styles.userInfo}>
          {user.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar_url} alt="" style={styles.avatar} referrerPolicy="no-referrer" />
          ) : (
            <div style={styles.avatarFallback}>{user.name.charAt(0).toUpperCase()}</div>
          )}
          <span style={styles.userName}>{user.name.split(" ")[0]}</span>
        </div>
        <div style={styles.userActions}>
          <button onClick={() => { router.push("/settings"); onNavigate(); }} style={styles.iconButton} title="Settings">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={handleSignOut} style={styles.iconButton} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Floating context menu — rendered in document.body via portal ──── */}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
            backgroundColor: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
            overflow: "hidden",
            minWidth: "130px",
          }}
        >
          <button
            style={styles.contextMenuItem}
            onClick={() => {
              setSingleDeleteTarget({ id: contextMenu.id, kind: contextMenu.kind });
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>,
        document.body
      )}

      {/* ── Single delete confirmation ─────────────────────────────────────── */}
      {singleDeleteTarget && (
        <div style={styles.modalOverlay} onClick={() => setSingleDeleteTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>
                {singleDeleteTarget.kind === "thread" ? "Delete this thread?" : "Delete this chat?"}
              </span>
              <button style={styles.modalClose} onClick={() => setSingleDeleteTarget(null)}>×</button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>
                This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setSingleDeleteTarget(null)}
                  style={{ ...styles.createButton, backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSingleDelete}
                  disabled={isDeletingSingle}
                  style={{ ...styles.createButton, backgroundColor: "#c0392b", flex: 1, ...(isDeletingSingle ? styles.createButtonDisabled : {}) }}
                >
                  {isDeletingSingle ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Standalone chats bulk delete confirmation ─────────────────────── */}
      {showBulkDeleteConfirm && (
        <div style={styles.modalOverlay} onClick={() => setShowBulkDeleteConfirm(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>
                Delete {selectedChatIds.size} {selectedChatIds.size === 1 ? "chat" : "chats"}?
              </span>
              <button style={styles.modalClose} onClick={() => setShowBulkDeleteConfirm(false)}>×</button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>
                This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setShowBulkDeleteConfirm(false)}
                  style={{ ...styles.createButton, backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkDelete}
                  disabled={isDeletingBulk}
                  style={{ ...styles.createButton, backgroundColor: "#c0392b", flex: 1, ...(isDeletingBulk ? styles.createButtonDisabled : {}) }}
                >
                  {isDeletingBulk ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Projects + chats bulk delete confirmation ─────────────────────── */}
      {showProjectBulkDeleteConfirm && (
        <div style={styles.modalOverlay} onClick={() => setShowProjectBulkDeleteConfirm(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>
                {selectedProjectIds.size > 0 && selectedProjectChatIds.size > 0
                  ? `Delete ${selectedProjectIds.size} ${selectedProjectIds.size === 1 ? "project" : "projects"} and ${selectedProjectChatIds.size} ${selectedProjectChatIds.size === 1 ? "chat" : "chats"}?`
                  : selectedProjectIds.size > 0
                    ? `Delete ${selectedProjectIds.size} ${selectedProjectIds.size === 1 ? "project" : "projects"}?`
                    : `Delete ${selectedProjectChatIds.size} ${selectedProjectChatIds.size === 1 ? "chat" : "chats"}?`}
              </span>
              <button style={styles.modalClose} onClick={() => setShowProjectBulkDeleteConfirm(false)}>×</button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>
                {selectedProjectIds.size > 0
                  ? "All chats and files in the selected projects will be permanently removed. This cannot be undone."
                  : "This cannot be undone."}
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setShowProjectBulkDeleteConfirm(false)}
                  style={{ ...styles.createButton, backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleProjectBulkDelete}
                  disabled={isDeletingProjectChats}
                  style={{ ...styles.createButton, backgroundColor: "#c0392b", flex: 1, ...(isDeletingProjectChats ? styles.createButtonDisabled : {}) }}
                >
                  {isDeletingProjectChats ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Family threads bulk delete confirmation ──────────────────────── */}
      {showThreadBulkDeleteConfirm && (
        <div style={styles.modalOverlay} onClick={() => setShowThreadBulkDeleteConfirm(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>
                Delete {selectedThreadIds.size} {selectedThreadIds.size === 1 ? "chat" : "chats"}?
              </span>
              <button style={styles.modalClose} onClick={() => setShowThreadBulkDeleteConfirm(false)}>×</button>
            </div>
            <div style={styles.modalBody}>
              <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", margin: 0 }}>
                This cannot be undone.
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => setShowThreadBulkDeleteConfirm(false)}
                  style={{ ...styles.createButton, backgroundColor: "var(--bg-secondary)", color: "var(--text-primary)", flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleThreadBulkDelete}
                  disabled={isDeletingThreads}
                  style={{ ...styles.createButton, backgroundColor: "#c0392b", flex: 1, ...(isDeletingThreads ? styles.createButtonDisabled : {}) }}
                >
                  {isDeletingThreads ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New Thread modal ─────────────────────────────────────────────── */}
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
                          style={{ ...styles.memberPickerRow, ...(checked ? styles.memberPickerRowChecked : {}) }}
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
              {threadErrorMsg && <p style={styles.errorMsg}>{threadErrorMsg}</p>}
              <button
                onClick={handleCreateThread}
                disabled={!newThreadName.trim() || isCreatingThread || selectedMemberIds.size === 0}
                style={{
                  ...styles.createButton,
                  ...(!newThreadName.trim() || isCreatingThread || selectedMemberIds.size === 0 ? styles.createButtonDisabled : {}),
                }}
              >
                {isCreatingThread ? "Creating…" : "Create group chat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Project modal ─────────────────────────────────────────────── */}
      {showNewProjectModal && (
        <div
          style={styles.modalOverlay}
          onClick={() => { setShowNewProjectModal(false); setNewProjectName(""); setNewProjectIcon(""); setProjectErrorMsg(""); }}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.modalTitle}>New project</span>
              <button
                style={styles.modalClose}
                onClick={() => { setShowNewProjectModal(false); setNewProjectName(""); setNewProjectIcon(""); setProjectErrorMsg(""); }}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.iconPickerRow}>
                {ICON_OPTIONS.map((icon) => (
                  <button
                    key={icon === "" ? "none" : icon}
                    style={{ ...styles.iconOption, ...(newProjectIcon === icon ? styles.iconOptionSelected : {}) }}
                    onClick={() => setNewProjectIcon(icon)}
                  >
                    {icon === "" ? <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>—</span> : icon}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateProject(); }}
                style={styles.nameInput}
                autoFocus
              />
              {projectErrorMsg && <p style={styles.errorMsg}>{projectErrorMsg}</p>}
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
  contentWrapper: {
    position: "relative",
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
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
  sectionEditButton: {
    fontSize: "0.6875rem",
    fontWeight: "500",
    color: "var(--accent)",
    cursor: "pointer",
    padding: "2px 4px",
    borderRadius: "var(--radius-sm)",
    transition: "opacity var(--transition)",
    flexShrink: 0,
  },
  emptyState: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    padding: "4px 8px",
  },

  // Project items (normal mode)
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

  // Project edit mode — group headers
  projectChatGroupHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px 2px",
    marginTop: "4px",
  },
  projectChatGroupName: {
    fontSize: "0.75rem",
    fontWeight: "600",
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
  chatItemSelected: {
    backgroundColor: "rgba(15, 110, 86, 0.06)",
    borderLeft: "2px solid var(--accent)",
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
  chatSelectCircle: {
    width: "18px",
    height: "18px",
    borderRadius: "var(--radius-full)",
    border: "1.5px solid var(--border-strong)",
    backgroundColor: "var(--bg-secondary)",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  deleteSelectedButton: {
    width: "100%",
    marginTop: "6px",
    padding: "8px 10px",
    fontSize: "0.8125rem",
    fontWeight: "500",
    color: "#c0392b",
    backgroundColor: "rgba(192, 57, 43, 0.08)",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background-color var(--transition)",
  },
  deleteSelectedButtonDisabled: {
    color: "var(--text-tertiary)",
    backgroundColor: "transparent",
    cursor: "default",
  },

  // Context menu
  contextMenuItem: {
    width: "100%",
    padding: "10px 14px",
    textAlign: "left" as const,
    fontSize: "0.875rem",
    fontWeight: "500",
    color: "#c0392b",
    cursor: "pointer",
    backgroundColor: "transparent",
    transition: "background-color var(--transition)",
    display: "block",
  },

  // Family
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

  // Modals
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
