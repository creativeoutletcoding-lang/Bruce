import { notFound, redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import ProjectHome from "@/components/project/ProjectHome";
import type {
  ProjectMemberDetail,
  ProjectMemberRole,
  File as BruceFile,
  ChatPreview,
} from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: Props) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const adminSupabase = createServiceRoleClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, icon, instructions, owner_id")
    .eq("id", projectId)
    .single();
  if (!project) notFound();

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

  const myMember = (memberRows ?? []).find((pm) => pm.user_id === user.id);
  const userRole = (myMember?.role ?? "member") as "owner" | "member";

  const { data: files } = await supabase
    .from("files")
    .select("*")
    .eq("project_id", projectId)
    .order("last_updated", { ascending: false });

  const { data: projectChats } = await supabase
    .from("chats")
    .select("id, title, owner_id, last_message_at")
    .eq("project_id", projectId)
    .order("last_message_at", { ascending: false });

  const initialChats: ChatPreview[] = (projectChats ?? []).map((c) => ({
    id: c.id as string,
    title: c.title as string | null,
    type: "private" as const,
    last_message_at: c.last_message_at as string,
    last_message_content: null,
    owner_id: c.owner_id as string,
  }));

  return (
    <ProjectHome
      projectId={projectId}
      projectName={project.name as string}
      projectIcon={project.icon as string}
      projectInstructions={(project.instructions as string) ?? ""}
      projectOwnerId={project.owner_id as string}
      members={members}
      files={(files as BruceFile[]) ?? []}
      initialChats={initialChats}
      userId={user.id}
      userRole={userRole}
    />
  );
}
