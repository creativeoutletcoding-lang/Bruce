import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { preferred_model?: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { preferred_model } = body;
  if (!preferred_model) return new Response("preferred_model required", { status: 400 });

  const { error } = await supabase
    .from("users")
    .update({ preferred_model })
    .eq("id", user.id);

  if (error) return new Response("Update failed", { status: 500 });
  return new Response(null, { status: 204 });
}
