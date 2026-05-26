import { notFound, redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import ProjectChatView from "@/components/project/ProjectChatView";
import { normalizeMessage } from "@/lib/chat/normalizeMessage";
import { getUserProfile } from "@/lib/user/getUserProfile";
import type {
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
    .select("id, sender_id, role, content, metadata, created_at, image_url, attachment_type, attachment_filename")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  const normalizedMessages = ((messages ?? []) as Array<Record<string, unknown>>).map((row) =>
    normalizeMessage(row)
  );

  const profile = await getUserProfile(supabase, user.id);
  const userColorHex = profile?.color_hex;

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

  const msgIds = normalizedMessages.map((m) => m.id);
  const { data: reactionRows } = msgIds.length > 0
    ? await adminSupabase
        .from("reactions")
        .select("message_id, user_id, type")
        .in("message_id", msgIds)
    : { data: [] as Array<{ message_id: string; user_id: string | null; type: string }> };

  return (
    <ProjectChatView
      chatId={chatId}
      projectId={projectId}
      projectName={project.name as string}
      projectIcon={project.icon as string}
      initialMessages={normalizedMessages}
      initialInput={initialInput}
      userColorHex={userColorHex}
      currentUserId={user.id}
      members={members}
      initialReactions={(reactionRows ?? []) as Array<{ message_id: string; user_id: string | null; type: string }>}
    />
  );
}
