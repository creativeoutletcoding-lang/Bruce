import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import ProjectHome from "@/components/project/ProjectHome";
import type {
  ProjectMemberDetail,
  File as BruceFile,
  ChatPreview,
} from "@/lib/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch project with members and files — RLS enforces membership
  const { data: project } = await supabase
    .from("projects")
    .select(`*, project_members(id, role, user_id), files(*)`)
    .eq("id", id)
    .single();

  if (!project) notFound();

  // Fetch member profiles via service role
  const memberRows = (
    project.project_members as Array<{ id: string; role: string; user_id: string }>
  ) ?? [];
  const userIds = memberRows.map((m) => m.user_id);

  const adminSupabase = createServiceRoleClient();
  const { data: userProfiles } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url")
    .in("id", userIds);

  const profileMap = new Map((userProfiles ?? []).map((u) => [u.id, u]));

  const members: ProjectMemberDetail[] = memberRows.map((pm) => {
    const profile = profileMap.get(pm.user_id);
    return {
      id: pm.user_id,
      name: profile?.name ?? "Unknown",
      avatar_url: profile?.avatar_url ?? null,
      role: pm.role as "owner" | "member",
    };
  });

  // Determine current user's project role
  const myMember = memberRows.find((pm) => pm.user_id === user.id);
  const myRole = (myMember?.role ?? "member") as "owner" | "member";

  // Fetch project chats with last message preview
  const { data: chats } = await supabase
    .from("chats")
    .select(`id, title, owner_id, last_message_at, messages(content, role, created_at)`)
    .eq("project_id", id)
    .order("last_message_at", { ascending: false });

  const chatPreviews: ChatPreview[] = (chats ?? []).map((c) => {
    const msgs = (
      c.messages as Array<{ content: string; role: string; created_at: string }>
    ) ?? [];
    const last = [...msgs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
    return {
      id: c.id as string,
      title: c.title as string | null,
      type: "private" as const,
      last_message_at: c.last_message_at as string,
      last_message_content: last?.content ?? null,
      owner_id: c.owner_id as string,
    };
  });

  return (
    <ProjectHome
      projectId={id}
      projectName={project.name as string}
      projectIcon={project.icon as string}
      projectInstructions={project.instructions as string}
      projectOwnerId={project.owner_id as string}
      members={members}
      files={(project.files as BruceFile[]) ?? []}
      initialChats={chatPreviews}
      userId={user.id}
      userRole={myRole}
    />
  );
}
