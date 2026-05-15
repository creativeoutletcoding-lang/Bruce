import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    preferred_model?: string;
    notification_sensitivity?: string;
    notification_preferences?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.preferred_model !== undefined) {
    update.preferred_model = body.preferred_model;
  }

  if (body.notification_sensitivity !== undefined) {
    const valid = ["low", "medium", "high"];
    if (!valid.includes(body.notification_sensitivity)) {
      return new Response("Invalid notification_sensitivity", { status: 400 });
    }
    update.notification_sensitivity = body.notification_sensitivity;
  }

  if (body.notification_preferences !== undefined) {
    if (typeof body.notification_preferences !== "object" || Array.isArray(body.notification_preferences)) {
      return new Response("Invalid notification_preferences", { status: 400 });
    }
    update.notification_preferences = body.notification_preferences;
  }

  if (Object.keys(update).length === 0) {
    return new Response("Nothing to update", { status: 400 });
  }

  const { error } = await supabase
    .from("users")
    .update(update)
    .eq("id", user.id);

  if (error) return new Response("Update failed", { status: 500 });
  return new Response(null, { status: 204 });
}
