import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return null;
  return user.id;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { content?: string; tier?: string; relevance_score?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.content === "string") updates.content = body.content.trim();
  if (body.tier === "core" || body.tier === "active" || body.tier === "archive") {
    updates.tier = body.tier;
  }
  if (typeof body.relevance_score === "number") {
    updates.relevance_score = Math.max(0, Math.min(100, body.relevance_score));
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin.from("memory").update(updates).eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to update memory" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("memory").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
