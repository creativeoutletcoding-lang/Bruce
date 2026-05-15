import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

// POST /api/notifications/register
// Upserts a device FCM token into user_fcm_tokens.
// Conflict on token (unique) updates user_id + last_seen_at so a token that
// moves to a different account is re-attributed on next registration.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { token: string; deviceHint?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.token?.trim()) return new Response("token required", { status: 400 });

  const adminSupabase = createServiceRoleClient();
  const { error } = await adminSupabase
    .from("user_fcm_tokens")
    .upsert(
      {
        user_id: user.id,
        token: body.token,
        device_hint: body.deviceHint ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" }
    );

  if (error) {
    console.error("[api/notifications/register] Failed:", error);
    return new Response("Failed to save token", { status: 500 });
  }

  return new Response(null, { status: 204 });
}
