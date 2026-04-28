import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  // RLS family_thread_chat_select policy filters to threads the user is a member of
  const { data } = await supabase
    .from("chats")
    .select("id, title, last_message_at")
    .eq("type", "family_thread")
    .is("deleted_at", null)
    .order("last_message_at", { ascending: false })
    .limit(30);

  return Response.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { name: string; memberIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return new Response("Name required", { status: 400 });

  const adminSupabase = createServiceRoleClient();

  const { data: thread, error } = await adminSupabase
    .from("chats")
    .insert({
      owner_id: user.id,
      project_id: null,
      type: "family_thread",
      title: name,
      last_message_at: new Date().toISOString(),
    })
    .select("id, title")
    .single();

  if (error || !thread) {
    console.error("[api/family/threads] Create failed", {
      userId: user.id,
      message: error?.message ?? "(no message)",
      code: error?.code ?? "(no code)",
      details: error?.details ?? "(no details)",
      hint: error?.hint ?? "(no hint)",
      fullError: JSON.stringify(error),
    });
    // DEBUG ONLY — returns full error to client so it surfaces in the UI
    return Response.json(
      {
        error: "Failed to create thread",
        debug: {
          userId: user.id,
          message: error?.message ?? null,
          code: error?.code ?? null,
          details: error?.details ?? null,
          hint: error?.hint ?? null,
        },
      },
      { status: 500 }
    );
  }

  // Determine members: provided list + creator always included
  let memberIds: string[] = body.memberIds?.length
    ? body.memberIds
    : await getAllActiveMemberIds(adminSupabase);

  // Ensure creator is always a member
  if (!memberIds.includes(user.id)) memberIds = [user.id, ...memberIds];

  await adminSupabase.from("chat_members").insert(
    memberIds.map((userId) => ({ chat_id: thread.id, user_id: userId }))
  );

  return Response.json(thread, { status: 201 });
}

async function getAllActiveMemberIds(
  adminSupabase: ReturnType<typeof createServiceRoleClient>
): Promise<string[]> {
  const { data } = await adminSupabase
    .from("users")
    .select("id")
    .eq("status", "active");
  return (data ?? []).map((u: { id: string }) => u.id);
}
