import { notFound, redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import ProjectChatWindow from "@/components/project/ProjectChatWindow";
import type {
  Message,
  ProjectMemberDetail,
  ProjectMemberRole,
  File as BruceFile,
  ChatPreview,
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

  // Project (RLS enforces membership)
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, icon, instructions, owner_id")
    .eq("id", projectId)
    .single();
  if (!project) notFound();

  // Chat belongs to this project
  const { data: chat } = await supabase
    .from("chats")
    .select("id, title, type")
    .eq("id", chatId)
    .eq("project_id", projectId)
    .single();
  if (!chat) notFound();

  // Messages for this chat
  const { data: messages } = await supabase
    .from("messages")
    .select("id, chat_id, sender_id, role, content, metadata, created_at, image_url, attachment_type, attachment_filename")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  // Current user profile
  const { data: userProfile } = await supabase
    .from("users")
    .select("color_hex, preferred_model")
    .eq("id", user.id)
    .single();
  const userColorHex = (userProfile as { color_hex: string; preferred_model: string | null } | null)?.color_hex;
  const preferredModel =
    (userProfile as { color_hex: string; preferred_model: string | null } | null)?.preferred_model ??
    "claude-sonnet-4-6";

  // Project members (service role to read other users' profiles)
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

  // Current user's role in this project
  const myMember = (memberRows ?? []).find((pm) => pm.user_id === user.id);
  const userRole = (myMember?.role ?? "member") as "owner" | "member";

  // Files attached to this project
  const { data: files } = await supabase
    .from("files")
    .select("*")
    .eq("project_id", projectId)
    .order("last_updated", { ascending: false });

  // All chats for this project (for the tab strip)
  const { data: projectChats } = await supabase
    .from("chats")
    .select("id, title, owner_id, last_message_at")
    .eq("project_id", projectId)
    .order("last_message_at", { ascending: false });

  const allChats: ChatPreview[] = (projectChats ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string | null,
    type: "private" as const,
    last_message_at: c.last_message_at as string,
    last_message_content: null,
    owner_id: c.owner_id as string,
  }));

  return (
    <ProjectChatWindow
      chatId={chatId}
      projectId={projectId}
      projectName={project.name as string}
      projectIcon={project.icon as string}
      projectInstructions={(project.instructions as string) ?? ""}
      projectOwnerId={project.owner_id as string}
      initialMessages={(messages as Message[]) ?? []}
      initialTitle={chat.title ?? "New conversation"}
      initialInput={initialInput}
      userColorHex={userColorHex}
      initialModel={preferredModel}
      currentUserId={user.id}
      members={members}
      userRole={userRole}
      initialFiles={(files as BruceFile[]) ?? []}
      initialAllChats={allChats}
    />
  );
}
