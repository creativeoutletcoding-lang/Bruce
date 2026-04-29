import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

async function checkOwnerOrAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  userId: string
): Promise<boolean> {
  const { data: member } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .single();

  if (member?.role === "owner") return true;

  const { data: userProfile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  return userProfile?.role === "admin";
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await checkOwnerOrAdmin(supabase, id, user.id);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { user_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  // Check if already a member
  const { data: existing } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", id)
    .eq("user_id", body.user_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Already a member" }, { status: 409 });
  }

  const { error } = await supabase
    .from("project_members")
    .insert({ project_id: id, user_id: body.user_id, role: "member" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = await checkOwnerOrAdmin(supabase, id, user.id);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { user_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  // Cannot remove the owner
  const { data: targetMember } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", id)
    .eq("user_id", body.user_id)
    .single();

  if (!targetMember) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (targetMember.role === "owner") {
    return NextResponse.json({ error: "Cannot remove the project owner" }, { status: 400 });
  }

  const { error } = await supabase
    .from("project_members")
    .delete()
    .eq("project_id", id)
    .eq("user_id", body.user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
