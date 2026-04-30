import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

// POST /api/notifications/presence
// Heartbeat: records that the caller is currently active in a specific chat.
// Called every 30 seconds from open chat windows. The server checks this before
// sending push notifications — if updated_at is within 30 minutes, skip the push.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { chatId: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.chatId) return new Response("chatId required", { status: 400 });

  const adminSupabase = createServiceRoleClient();
  await adminSupabase.from("user_presence").upsert(
    {
      user_id: user.id,
      chat_id: body.chatId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,chat_id" }
  );

  return new Response(null, { status: 204 });
}
