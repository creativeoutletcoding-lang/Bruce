import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { UserSummary } from "@/lib/types";

export const runtime = "nodejs";

// Service role required: users RLS only exposes own row to non-admins,
// but member picker needs the full household list.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminSupabase = createServiceRoleClient();

  const [{ data: users, error }, { data: exclusions }] = await Promise.all([
    adminSupabase
      .from("users")
      .select("id, name, avatar_url, role, color_hex")
      .eq("status", "active")
      .order("name"),
    adminSupabase
      .from("member_exclusions")
      .select("user_id_a, user_id_b")
      .or(`user_id_a.eq.${user.id},user_id_b.eq.${user.id}`),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const excludedIds = new Set(
    (exclusions ?? []).map((row) =>
      row.user_id_a === user.id ? row.user_id_b : row.user_id_a
    )
  );

  const filtered = (users ?? []).filter((u) => !excludedIds.has(u.id));

  return NextResponse.json(filtered as UserSummary[]);
}
