import { notFound, redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

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

  // Verify membership via RLS
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();
  if (!project) notFound();

  // Redirect to the most recent chat
  const { data: latestChat } = await supabase
    .from("chats")
    .select("id")
    .eq("project_id", id)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestChat) redirect(`/projects/${id}/chat/${latestChat.id}`);

  // No chats yet — create one and redirect
  const adminSupabase = createServiceRoleClient();
  const { data: newChat } = await adminSupabase
    .from("chats")
    .insert({
      owner_id: user.id,
      project_id: id,
      type: "private",
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (newChat) redirect(`/projects/${id}/chat/${newChat.id}`);
  notFound();
}
