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
  const { data: users, error } = await adminSupabase
    .from("users")
    .select("id, name, avatar_url, role, color_hex")
    .eq("status", "active")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((users ?? []) as UserSummary[]);
}
