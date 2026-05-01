import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  console.log("[DELETE /api/chats] userId:", user?.id ?? "(unauthenticated)");
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: unknown = body.ids;
  console.log("[DELETE /api/chats] ids received:", JSON.stringify(ids));
  if (!Array.isArray(ids) || ids.length === 0) {
    console.log("[DELETE /api/chats] rejected: ids missing or empty");
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }

  const validIds = ids.filter((id): id is string => typeof id === "string");
  console.log("[DELETE /api/chats] validIds:", JSON.stringify(validIds));
  if (validIds.length === 0) {
    console.log("[DELETE /api/chats] rejected: no valid string ids");
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

  console.log("[DELETE /api/chats] supabase result — error:", error ? JSON.stringify(error) : null, "deleted rows:", JSON.stringify(deleted));

  if (error) {
    console.log("[DELETE /api/chats] response: 500", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const count = (deleted ?? []).length;
  if (count === 0) {
    console.log("[DELETE /api/chats] response: 400 — 0 rows deleted");
    return NextResponse.json({ error: "No chats deleted — check ownership or chat IDs" }, { status: 400 });
  }

  console.log("[DELETE /api/chats] response: 200 — deleted", count, "rows");
  return NextResponse.json({ deleted: count });
}
