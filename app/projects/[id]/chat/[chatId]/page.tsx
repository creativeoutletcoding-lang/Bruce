import { notFound, redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import ProjectChatView from "@/components/project/ProjectChatView";
import type {
  Message,
  ProjectMemberDetail,
  ProjectMemberRole,
} from "@/lib/types";

interface Props {
  params: Promise<{ id: string; chatId: string }>;
  searchParams: Promise<Record<string, string>>;
}

export default async function ProjectChatPage({ params, searchParams }: Props) {
  const { id: projectId, chatId } = await params;
  const { q: initialInput } = await searchParams;
  const supabase = await createClient();
  const adminSupabase = createServiceRoleClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, icon")
    .eq("id", projectId)
    .single();
  if (!project) notFound();

  const { data: chat } = await supabase
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .eq("project_id", projectId)
    .single();
  if (!chat) notFound();

  const { data: messages } = await supabase
    .from("messages")
    .select("id, chat_id, sender_id, role, content, metadata, created_at, image_url, attachment_type, attachment_filename")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const { data: userProfile } = await supabase
    .from("users")
    .select("color_hex")
    .eq("id", user.id)
    .single();
  const userColorHex = (userProfile as { color_hex: string } | null)?.color_hex;

  const { data: memberRows } = await adminSupabase
    .from("project_members")
    .select("user_id, role, users(id, name, color_hex)")
    .eq("project_id", projectId);

  const members: ProjectMemberDetail[] = (memberRows ?? []).map((pm) => {
    const u = (pm.users as unknown) as { id: string; name: string; color_hex: string } | null;
    return {
      id: u?.id ?? pm.user_id,
      name: u?.name ?? "Member",
      avatar_url: null,
      color_hex: u?.color_hex ?? "#0F6E56",
      role: pm.role as ProjectMemberRole,
    };
  });

  return (
    <ProjectChatView
      chatId={chatId}
      projectId={projectId}
      projectName={project.name as string}
      projectIcon={project.icon as string}
      initialMessages={(messages as Message[]) ?? []}
      initialInput={initialInput}
      userColorHex={userColorHex}
      currentUserId={user.id}
      members={members}
    />
  );
}
