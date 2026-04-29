import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Admin check — use authenticated client (RLS: users can read their own row)
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; role?: "member" | "admin" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.role && body.role !== "member" && body.role !== "admin") {
    return NextResponse.json({ error: "role must be member or admin" }, { status: 400 });
  }

  // Insert via service role — invite_tokens RLS is admin-only for writes
  const adminSupabase = createServiceRoleClient();
  const { data: token, error } = await adminSupabase
    .from("invite_tokens")
    .insert({
      created_by: user.id,
      email: body.email?.trim() ?? null,
      role: body.role ?? "member",
    })
    .select("token")
    .single();

  if (error || !token) {
    console.error("[api/admin/invites] Failed to create token:", error?.message);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const invite_url = `${appUrl}/join?token=${token.token}`;

  return NextResponse.json({ invite_url }, { status: 201 });
}
