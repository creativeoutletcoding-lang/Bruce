import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProjectChatWindow from "@/components/project/ProjectChatWindow";
import type { Message } from "@/lib/types";

interface Props {
  params: Promise<{ id: string; chatId: string }>;
  searchParams: Promise<Record<string, string>>;
}

export default async function ProjectChatPage({ params, searchParams }: Props) {
  const { id: projectId, chatId } = await params;
  const { q: initialInput } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify project membership via RLS
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, icon")
    .eq("id", projectId)
    .single();

  if (!project) notFound();

  // Verify chat belongs to this project
  const { data: chat } = await supabase
    .from("chats")
    .select("id, title, type")
    .eq("id", chatId)
    .eq("project_id", projectId)
    .single();

  if (!chat) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, chat_id, sender_id, role, content, metadata, created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const { data: userProfile } = await supabase
    .from("users")
    .select("color_hex, preferred_model")
    .eq("id", user.id)
    .single();
  const userColorHex = (userProfile as { color_hex: string; preferred_model: string | null } | null)?.color_hex;
  const preferredModel = (userProfile as { color_hex: string; preferred_model: string | null } | null)?.preferred_model ?? "claude-sonnet-4-6";

  return (
    <ProjectChatWindow
      chatId={chatId}
      projectId={projectId}
      projectName={project.name as string}
      projectIcon={project.icon as string}
      initialMessages={(messages as Message[]) ?? []}
      initialTitle={chat.title ?? "New conversation"}
      initialInput={initialInput}
      userColorHex={userColorHex}
      initialModel={preferredModel}
    />
  );
}
