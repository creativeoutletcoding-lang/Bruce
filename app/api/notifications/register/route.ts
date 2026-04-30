import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

// POST /api/notifications/register
// Saves the caller's FCM token to users.fcm_token.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { token: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.token?.trim()) return new Response("token required", { status: 400 });

  const adminSupabase = createServiceRoleClient();
  const { error } = await adminSupabase
    .from("users")
    .update({ fcm_token: body.token })
    .eq("id", user.id);

  if (error) {
    console.error("[api/notifications/register] Failed:", error);
    return new Response("Failed to save token", { status: 500 });
  }

  return new Response(null, { status: 204 });
}
