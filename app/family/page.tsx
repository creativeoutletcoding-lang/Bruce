import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import FamilyChatWindow from "@/components/family/FamilyChatWindow";
import FamilyTopBar from "@/components/family/FamilyTopBar";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import type { UserSummary } from "@/lib/types";

export default async function FamilyPage() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect("/login");

  // family_group chat is readable by all authenticated users via RLS.
  const { data: existingChat } = await supabase
    .from("chats")
    .select("id")
    .eq("type", "family_group")
    .maybeSingle();

  const adminSupabase = createServiceRoleClient();

  if (!existingChat) {
    redirect("/chat");
  }

  const chatId = existingChat.id as string;

  // Load all active members for the sender map
  const { data: membersRaw } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url, role, color_hex")
    .eq("status", "active");

  const members: UserSummary[] = (membersRaw ?? []) as UserSummary[];

  const { data: rawMessages } = await adminSupabase
    .from("messages")
    .select("id, role, content, created_at, sender_id, image_url, attachment_type, attachment_filename, metadata")
    .eq("chat_id", chatId)
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

  return (
    <FamilyChatWindow
      chatId={chatId}
      currentUserId={authUser.id}
      members={members}
      initialMessages={messages}
      initialReactions={(reactionRows ?? []) as Array<{ message_id: string; user_id: string | null; type: string }>}
      topbar={<FamilyTopBar />}
    />
  );
}
