import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  // Any authenticated member can soft-delete a family thread
  const adminSupabase = createServiceRoleClient();

  const { error } = await adminSupabase
    .from("chats")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("type", "family_thread"); // safety: never delete the family_group chat this way

  if (error) {
    console.error("[api/family/threads/[id]] Delete failed:", error);
    return new Response("Failed to delete thread", { status: 500 });
  }

  return new Response(null, { status: 204 });
}
