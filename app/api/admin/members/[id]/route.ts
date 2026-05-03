import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { action?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  if (body.action === "deactivate") {
    const purgeAt = new Date();
    purgeAt.setDate(purgeAt.getDate() + 30);

    const { error } = await admin
      .from("users")
      .update({
        status: "deactivated",
        deactivated_at: new Date().toISOString(),
        purge_at: purgeAt.toISOString(),
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Failed to deactivate" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reactivate") {
    const { error } = await admin
      .from("users")
      .update({ status: "active", deactivated_at: null, purge_at: null })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Failed to reactivate" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.role === "admin" || body.role === "member") {
    // Can't demote yourself
    if (id === user.id && body.role !== "admin") {
      return NextResponse.json({ error: "Cannot demote yourself" }, { status: 400 });
    }

    const { error } = await admin
      .from("users")
      .update({ role: body.role })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
