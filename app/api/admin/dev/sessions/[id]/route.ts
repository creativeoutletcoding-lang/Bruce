import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  return profile?.role === "admin";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) return new Response("Forbidden", { status: 403 });

  const { id } = await params;

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return new Response("Name required", { status: 400 });

  const serviceSupabase = createServiceRoleClient();
  const { data, error } = await serviceSupabase
    .from("admin_dev_sessions")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[admin/dev/sessions/[id]] PATCH error", error);
    return new Response("DB error", { status: 500 });
  }
  return Response.json(data);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) return new Response("Forbidden", { status: 403 });

  const { id } = await params;
  const serviceSupabase = createServiceRoleClient();

  // Messages cascade-delete via FK ON DELETE CASCADE
  const { error } = await serviceSupabase
    .from("admin_dev_sessions")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("[admin/dev/sessions/[id]] DELETE error", error);
    return new Response("DB error", { status: 500 });
  }
  return new Response(null, { status: 204 });
}
