import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

// Toggle thumbs-up reaction for the authenticated user.
export async function POST(request: NextRequest, { params }: Props) {
  const { id: messageId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { type?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const type = body.type ?? "thumbs_up";

  // Resolve chat_id — needed for the insert and for access verification.
  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .select("chat_id")
    .eq("id", messageId)
    .single();

  if (msgErr || !msg) {
    return new Response("Message not found", { status: 404 });
  }
  const chatId = (msg as { chat_id: string }).chat_id;

  const adminSupabase = createServiceRoleClient();

  // Check if the reaction already exists.
  const { data: existing } = await adminSupabase
    .from("reactions")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .eq("type", type)
    .maybeSingle();

  if (existing) {
    await adminSupabase.from("reactions").delete().eq("id", (existing as { id: string }).id);
    return Response.json({ action: "removed" });
  }

  const { error: insertErr } = await adminSupabase.from("reactions").insert({
    message_id: messageId,
    chat_id: chatId,
    user_id: user.id,
    type,
  });

  if (insertErr) {
    return new Response("Failed to add reaction", { status: 500 });
  }
  return Response.json({ action: "added" });
}
