import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import FamilyChatWindow from "@/components/family/FamilyChatWindow";
import FamilyThreadTopBar from "@/components/family/FamilyThreadTopBar";
import type { UserSummary } from "@/lib/types";

interface RawMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  sender_id: string | null;
}

export default async function FamilyThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  const adminSupabase = createServiceRoleClient();

  // Load thread — redirect if deleted or wrong type
  const { data: thread } = await adminSupabase
    .from("chats")
    .select("id, title, owner_id")
    .eq("id", id)
    .eq("type", "family_thread")
    .maybeSingle();

  if (!thread) redirect("/family");

  // Verify access: user is the owner OR has a chat_members row.
  // The owner check is the primary fallback — the creator always owns the
  // thread, so they should have access even if the chat_members insert hasn't
  // fully propagated yet (e.g., brief Supabase pooler lag).
  const isOwner = thread.owner_id === authUser.id;

  if (!isOwner) {
    const { data: memberRow } = await adminSupabase
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", id)
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (!memberRow) redirect("/family");
  }

  // Load all active household members
  const { data: allMembersRaw } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url, role")
    .eq("status", "active");

  const allMembers: UserSummary[] = (allMembersRaw ?? []) as UserSummary[];

  // Load this thread's current members
  const { data: threadMembersRaw } = await adminSupabase
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", id);

  const threadMemberIds = (threadMembersRaw ?? []).map(
    (r: { user_id: string }) => r.user_id
  );

  const memberMap: Record<string, { name: string; avatar_url: string | null }> = {};
  allMembers.forEach((m) => {
    memberMap[m.id] = { name: m.name, avatar_url: m.avatar_url };
  });

  // Load recent messages
  const { data: rawMessages } = await adminSupabase
    .from("messages")
    .select("id, role, content, created_at, sender_id")
    .eq("chat_id", id)
    .order("created_at", { ascending: true })
    .limit(100);

  const messages = ((rawMessages ?? []) as RawMessage[]).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
    created_at: m.created_at,
    sender_id: m.sender_id,
    sender_name: m.sender_id ? (memberMap[m.sender_id]?.name ?? null) : null,
    sender_avatar: m.sender_id ? (memberMap[m.sender_id]?.avatar_url ?? null) : null,
  }));

  return (
    <FamilyChatWindow
      chatId={id}
      currentUserId={authUser.id}
      members={allMembers}
      initialMessages={messages}
      topbar={
        <FamilyThreadTopBar
          threadId={id}
          threadName={thread.title ?? "Group Chat"}
          allMembers={allMembers}
          threadMemberIds={threadMemberIds}
        />
      }
      placeholder={`Message in ${thread.title ?? "this group chat"}…`}
    />
  );
}
