import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: unknown = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const validIds = ids.filter((id): id is string => typeof id === "string");
  if (validIds.length === 0) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  // Service role bypasses RLS so any authenticated member can delete family_group,
  // family_thread, or their own private/incognito chats. Auth is verified above.
  const adminSupabase = createServiceRoleClient();
  const { data: deleted, error } = await adminSupabase
    .from("chats")
    .delete()
    .in("id", validIds)
    .in("type", ["private", "incognito", "family_thread", "family_group"])
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const count = (deleted ?? []).length;
  if (count === 0) {
    return NextResponse.json({ error: "No chats deleted — check ownership or chat IDs" }, { status: 400 });
  }

  return NextResponse.json({ deleted: count });
}
