import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { MovableProject, MovableProjectMember } from "@/lib/types";

export const runtime = "nodejs";

// GET /api/projects/movable — the active projects the current user is a member
// of, with member pips, for the "Move to project" picker. Project visibility is
// RLS-gated (projects_select_member); member user profiles are fetched via
// service role because users_select_own only returns the requester's own row.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, icon, project_members(user_id)")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const projectRows = (projects ?? []) as Array<{
    id: string;
    name: string;
    icon: string;
    project_members: Array<{ user_id: string }>;
  }>;

  // Collect every member user id across the visible projects, then resolve
  // profiles in one service-role query.
  const memberIds = new Set<string>();
  for (const p of projectRows) {
    for (const m of p.project_members ?? []) memberIds.add(m.user_id);
  }

  const profileById: Record<string, MovableProjectMember> = {};
  if (memberIds.size > 0) {
    const admin = createServiceRoleClient();
    const { data: profiles } = await admin
      .from("users")
      .select("id, name, color_hex")
      .in("id", Array.from(memberIds));
    for (const u of (profiles ?? []) as Array<{ id: string; name: string; color_hex: string }>) {
      profileById[u.id] = { id: u.id, name: u.name, color_hex: u.color_hex ?? "#0F6E56" };
    }
  }

  const result: MovableProject[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    members: (p.project_members ?? [])
      .map((m) => profileById[m.user_id])
      .filter((m): m is MovableProjectMember => Boolean(m)),
  }));

  return NextResponse.json(result);
}
