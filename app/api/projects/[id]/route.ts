import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import type { ProjectDetail, ProjectMemberDetail, File as BruceFile } from "@/lib/types";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS ensures user is a project member (projects_select_member policy)
  const { data: project, error } = await supabase
    .from("projects")
    .select(`*, project_members(id, role, user_id), files(*)`)
    .eq("id", id)
    .single();

  if (error || !project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Fetch user profiles via service role since non-admin RLS only returns own row
  const memberRows = (
    project.project_members as Array<{ id: string; role: string; user_id: string }>
  ) ?? [];
  const userIds = memberRows.map((m) => m.user_id);

  const adminSupabase = createServiceRoleClient();
  const { data: userProfiles } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url")
    .in("id", userIds);

  const profileMap = new Map(
    (userProfiles ?? []).map((u) => [u.id, u])
  );

  const members: ProjectMemberDetail[] = memberRows.map((pm) => {
    const profile = profileMap.get(pm.user_id);
    return {
      id: pm.user_id,
      name: profile?.name ?? "Unknown",
      avatar_url: profile?.avatar_url ?? null,
      role: pm.role as "owner" | "member",
    };
  });

  // Strip joined relations before spreading (destructured to omit from spread)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { project_members: _pm, files: _f, ...projectBase } = project as typeof project & {
    project_members: unknown;
    files: unknown;
  };

  const result: ProjectDetail = {
    ...(projectBase as Parameters<typeof Object.assign>[1]),
    members,
    files: (project.files as BruceFile[]) ?? [],
  };

  return NextResponse.json(result);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", id)
    .single();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (project.owner_id !== user.id && userProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { name?: string; icon?: string; instructions?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, string> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.icon !== undefined) updates.icon = body.icon;
  if (body.instructions !== undefined) updates.instructions = body.instructions;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("owner_id")
    .eq("id", id)
    .single();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (project.owner_id !== user.id && userProfile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("projects")
    .update({ status: "archived" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
