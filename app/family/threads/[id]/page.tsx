import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import FamilyChatWindow from "@/components/family/FamilyChatWindow";
import FamilyThreadTopBar from "@/components/family/FamilyThreadTopBar";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import { getExcludedMemberIds } from "@/lib/members/getExcludedMemberIds";
import type { UserSummary } from "@/lib/types";

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

  // Load thread — redirect if wrong type or not found
  const { data: thread } = await adminSupabase
    .from("chats")
    .select("id, title")
    .eq("id", id)
    .eq("type", "family_thread")
    .maybeSingle();

  if (!thread) redirect("/family");

  // Verify the current user is a member of this thread
  const { data: memberRow } = await adminSupabase
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", id)
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (!memberRow) redirect("/family");

  // Load all active household members
  const { data: allMembersRaw } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url, role, color_hex")
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

  // Load recent messages
  const { data: rawMessages } = await adminSupabase
    .from("messages")
    .select("id, role, content, created_at, sender_id, image_url, attachment_type, attachment_filename, metadata")
    .eq("chat_id", id)
    .order("created_at", { ascending: true })
    .limit(100);

  const messages = ((rawMessages ?? []) as Array<Record<string, unknown>>).map((row) =>
    normalizeMessage(row)
  );

  const msgIds = messages.map((m) => m.id);
  const { data: reactionRows } = msgIds.length > 0
    ? await adminSupabase
        .from("reactions")
        .select("message_id, user_id, type")
        .in("message_id", msgIds)
    : { data: [] as Array<{ message_id: string; user_id: string | null; type: string }> };

  const excludedMemberIds = await getExcludedMemberIds(authUser.id);

  return (
    <FamilyChatWindow
      chatId={id}
      currentUserId={authUser.id}
      members={allMembers}
      initialMessages={messages}
      initialReactions={(reactionRows ?? []) as Array<{ message_id: string; user_id: string | null; type: string }>}
      topbar={
        <FamilyThreadTopBar
          threadId={id}
          threadName={thread.title ?? "Group Chat"}
          allMembers={allMembers}
          threadMemberIds={threadMemberIds}
          excludedMemberIds={excludedMemberIds}
        />
      }
      placeholder={`Message in ${thread.title ?? "this group chat"}…`}
    />
  );
}
