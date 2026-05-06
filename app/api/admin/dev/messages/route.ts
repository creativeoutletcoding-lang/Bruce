import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

export async function GET() {
  if (!(await isAdmin())) return new Response("Forbidden", { status: 403 });

  const serviceSupabase = createServiceRoleClient();
  const { data, error } = await serviceSupabase
    .from("admin_dev_messages")
    .select("id, role, content, created_at")
    .order("created_at", { ascending: true });

  if (error) return new Response("DB error", { status: 500 });
  return Response.json(data ?? []);
}

export async function DELETE() {
  if (!(await isAdmin())) return new Response("Forbidden", { status: 403 });

  const serviceSupabase = createServiceRoleClient();
  const { error } = await serviceSupabase
    .from("admin_dev_messages")
    .delete()
    .not("id", "is", null);

  if (error) return new Response("DB error", { status: 500 });
  return new Response(null, { status: 204 });
}
