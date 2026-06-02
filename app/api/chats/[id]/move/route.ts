import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

// PATCH /api/chats/[id]/move — move a standalone private chat into a project.
// Body: { projectId: string }. Validates that the chat is standalone, owned by
// the requester, and that the requester is a member of the target project.
// All gates lean on RLS (chats_select / chats_update_owner / project_members_select)
// rather than service role — the privacy wall stays at the database.
export async function PATCH(req: NextRequest, { params }: Props) {
  const { id: chatId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { projectId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const projectId = body.projectId;
  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  // Chat must exist and be visible to this user (RLS). Standalone private + owned.
  const { data: chat } = await supabase
    .from("chats")
    .select("id, owner_id, project_id, type")
    .eq("id", chatId)
    .single();
  if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  if (chat.owner_id !== user.id) {
    return NextResponse.json({ error: "Not the chat owner" }, { status: 403 });
  }
  if (chat.project_id) {
    return NextResponse.json({ error: "Chat is already in a project" }, { status: 409 });
  }
  if (chat.type !== "private") {
    return NextResponse.json({ error: "Only standalone private chats can be moved" }, { status: 400 });
  }

  // Requester must be a member of the target project. project_members_select RLS
  // returns the row only for the user's own membership.
  const { data: membership } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Not a member of the target project" }, { status: 403 });
  }

  // Project name/icon for the breadcrumb (member can select via RLS).
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, icon")
    .eq("id", projectId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const { data: updated, error } = await supabase
    .from("chats")
    .update({ project_id: projectId })
    .eq("id", chatId)
    .select("id, title, type, project_id, last_message_at")
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: error?.message ?? "Failed to move chat" }, { status: 500 });
  }

  return NextResponse.json({
    ...updated,
    project_name: project.name,
    project_icon: project.icon,
  });
}
