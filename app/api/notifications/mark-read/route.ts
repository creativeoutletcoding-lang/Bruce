import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

// POST /api/notifications/mark-read
// Body: { chatId?: string }
//   No chatId  → marks ALL of the caller's unread notifications as read.
//   With chatId → marks only that chat's unread notifications as read.
// Called by ChatShell on mount (no chatId) and FamilyChatWindow on mount (chatId).
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let chatId: string | undefined;
  try {
    const body = await request.json();
    chatId = body.chatId;
  } catch {
    // No body is valid — means mark all.
  }

  const now = new Date().toISOString();
  const adminSupabase = createServiceRoleClient();

  let query = adminSupabase
    .from("notifications")
    .update({ read: true, read_at: now })
    .eq("user_id", user.id)
    .eq("read", false);

  if (chatId) {
    query = query.eq("chat_id", chatId);
  }

  const { error } = await query;

  if (error) {
    console.error("[api/notifications/mark-read] Failed:", error);
    return new Response("Failed to mark notifications read", { status: 500 });
  }

  return new Response(null, { status: 204 });
}
