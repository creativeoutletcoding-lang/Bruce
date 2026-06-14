import { notFound, redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import ChatWindow from "@/components/chat/ChatWindow";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import { getUserProfile } from "@/lib/user/getUserProfile";
import { resolveModel } from "@/lib/models";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ChatIdPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify the chat exists and belongs to this user (RLS enforces ownership)
  const { data: chat } = await supabase
    .from("chats")
    .select("id, title, type, project_id, owner_id")
    .eq("id", id)
    .neq("type", "incognito")
    .single();

  if (!chat) notFound();

  // Project chats belong at /projects/[id]/chat/[chatId] — redirect if needed
  if (chat.project_id) {
    redirect(`/projects/${chat.project_id}/chat/${id}`);
  }

  // "Move to project" is only offered on standalone private chats the viewer owns.
  const canMoveToProject = chat.type === "private" && chat.owner_id === user.id;

  // Load messages
  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, role, content, metadata, created_at, image_url, attachment_type, attachment_filename")
    .eq("chat_id", id)
    .order("created_at", { ascending: true });

  const normalizedMessages = ((messages ?? []) as Array<Record<string, unknown>>).map((row) =>
    normalizeMessage(row)
  );

  const profile = await getUserProfile(supabase, user.id);
  const userColorHex = profile?.color_hex;
  const preferredModel = resolveModel(profile?.preferred_model).id;
  const preferredEffort = profile?.preferred_effort ?? null;

  const adminSupabase = createServiceRoleClient();
  const msgIds = normalizedMessages.map((m) => m.id);
  const { data: reactionRows } = msgIds.length > 0
    ? await adminSupabase
        .from("reactions")
        .select("message_id, user_id, type")
        .in("message_id", msgIds)
    : { data: [] as Array<{ message_id: string; user_id: string | null; type: string }> };

  return (
    <ChatWindow
      chatId={id}
      initialMessages={normalizedMessages}
      initialTitle={chat.title ?? "Chat"}
      userColorHex={userColorHex}
      initialModel={preferredModel}
      initialEffort={preferredEffort}
      currentUserId={user.id}
      initialReactions={(reactionRows ?? []) as Array<{ message_id: string; user_id: string | null; type: string }>}
      canMoveToProject={canMoveToProject}
    />
  );
}
