import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatWindow from "@/components/chat/ChatWindow";
import type { Message } from "@/lib/types";

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
    .select("id, title, type, project_id")
    .eq("id", id)
    .neq("type", "incognito")
    .single();

  if (!chat) notFound();

  // Project chats belong at /projects/[id]/chat/[chatId] — redirect if needed
  if (chat.project_id) {
    redirect(`/projects/${chat.project_id}/chat/${id}`);
  }

  // Load messages
  const { data: messages } = await supabase
    .from("messages")
    .select("id, chat_id, sender_id, role, content, metadata, created_at")
    .eq("chat_id", id)
    .order("created_at", { ascending: true });

  const { data: userProfile } = await supabase
    .from("users")
    .select("color_hex, preferred_model")
    .eq("id", user.id)
    .single();
  const userColorHex = (userProfile as { color_hex: string; preferred_model: string | null } | null)?.color_hex;
  const preferredModel = (userProfile as { color_hex: string; preferred_model: string | null } | null)?.preferred_model ?? "claude-sonnet-4-6";

  return (
    <ChatWindow
      chatId={id}
      initialMessages={(messages as Message[]) ?? []}
      initialTitle={chat.title ?? "Chat"}
      userColorHex={userColorHex}
      initialModel={preferredModel}
    />
  );
}
