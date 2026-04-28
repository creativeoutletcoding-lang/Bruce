import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ProjectListItem } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: projects, error } = await supabase
    .from("projects")
    .select(
      `id, name, icon, status, created_at,
       project_members(id),
       chats(last_message_at)`
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result: ProjectListItem[] = (projects ?? []).map((p) => {
    const members = (p.project_members as Array<{ id: string }>) ?? [];
    const chats = (p.chats as Array<{ last_message_at: string }>) ?? [];
    const lastChatDate =
      chats.length > 0
        ? chats
            .map((c) => c.last_message_at)
            .sort()
            .reverse()[0]
        : null;
    return {
      id: p.id as string,
      name: p.name as string,
      icon: p.icon as string,
      status: p.status as "active" | "archived",
      member_count: members.length,
      last_chat_date: lastChatDate,
      created_at: p.created_at as string,
    };
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name: string; icon?: string; instructions?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, icon = "📁", instructions = "" } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }

  // Use service role: projects_select_member RLS requires existing membership,
  // which doesn't exist yet at creation time. Auth is already verified above.
  const adminSupabase = createServiceRoleClient();

  const { data: project, error: projectError } = await adminSupabase
    .from("projects")
    .insert({ owner_id: user.id, name: name.trim(), icon, instructions })
    .select("*")
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { error: projectError?.message ?? "Failed to create project" },
      { status: 500 }
    );
  }

  const { error: memberError } = await adminSupabase
    .from("project_members")
    .insert({ project_id: project.id, user_id: user.id, role: "owner" });

  if (memberError) {
    console.error("[api/projects] Failed to add owner member:", memberError);
  }

  return NextResponse.json(project, { status: 201 });
}
