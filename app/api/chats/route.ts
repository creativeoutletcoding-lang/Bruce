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

  const { error } = await supabase
    .from("chats")
    .delete()
    .in("id", validIds)
    .eq("owner_id", user.id)
    .is("project_id", null)
    .in("type", ["private", "incognito"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deleted: validIds.length });
}
