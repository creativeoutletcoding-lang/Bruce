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

  // Gate with the authenticated anon client so RLS enforces ownership.
  // Only chat IDs the user is allowed to read (owns or is a member of) come
  // back — preventing cross-user deletion of private/incognito chats.
  const { data: allowedChats } = await supabase
    .from("chats")
    .select("id")
    .in("id", validIds)
    .in("type", ["private", "incognito", "family_thread", "family_group"]);

  const allowedIds = (allowedChats ?? []).map((c: { id: string }) => c.id);
  if (allowedIds.length === 0) {
    return NextResponse.json({ error: "No chats deleted — check ownership or chat IDs" }, { status: 400 });
  }

  const adminSupabase = createServiceRoleClient();
  const { data: deleted, error } = await adminSupabase
    .from("chats")
    .delete()
    .in("id", allowedIds)
    .select("id");

  if (error) {
    console.error("[api/chats] Delete failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const count = (deleted ?? []).length;
  if (count === 0) {
    return NextResponse.json({ error: "No chats deleted — check ownership or chat IDs" }, { status: 400 });
  }

  return NextResponse.json({ deleted: count });
}
