import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { isValidModelId, isValidEffort } from "@/lib/models";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    preferred_model?: string;
    preferred_effort?: string | null;
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
    // Whitelist against the live model list (mirrors notification_sensitivity)
    // so a stale/unknown id can never be persisted and later 400 at Anthropic.
    if (!isValidModelId(body.preferred_model)) {
      return new Response("Invalid preferred_model", { status: 400 });
    }
    update.preferred_model = body.preferred_model;
  }

  if (body.preferred_effort !== undefined) {
    // null clears the override (falls back to the model's default effort).
    if (body.preferred_effort !== null && !isValidEffort(body.preferred_effort)) {
      return new Response("Invalid preferred_effort", { status: 400 });
    }
    update.preferred_effort = body.preferred_effort;
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
