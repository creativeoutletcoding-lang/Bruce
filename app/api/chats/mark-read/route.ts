import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

// Updates chat_members.last_read_at to now() for the calling user. Clears the
// sidebar unread dot for that chat. For chats that don't have a chat_members
// row for this user (private 1:1 chats are owner-only), this is a no-op — the
// route doesn't error so callers can fire-and-forget for every chat open.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const chatId = body.chatId;
  if (typeof chatId !== "string" || !chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  // Use service role so we don't have to worry about UPDATE RLS having landed
  // yet — by definition we are updating only this user's own row.
  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("chat_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[api/chats/mark-read] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
