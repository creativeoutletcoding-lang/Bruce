import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  // owner_id check is the security gate — RLS enforces the same constraint.
  // family_group is never deletable; family_thread soft-delete is intentionally
  // replaced here with hard delete for simplicity.
  const { error } = await supabase
    .from("chats")
    .delete()
    .in("id", validIds)
    .eq("owner_id", user.id)
    .in("type", ["private", "incognito", "family_thread"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: validIds.length });
}
