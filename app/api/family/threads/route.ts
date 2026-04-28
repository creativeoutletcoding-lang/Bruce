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
    });
    return new Response("Failed to create thread", { status: 500 });
  }

  // Insert creator membership first, atomically. If this fails the thread is
  // unusable — delete it and surface the error so we can diagnose.
  const { error: creatorErr } = await adminSupabase
    .from("chat_members")
    .insert({ chat_id: thread.id, user_id: user.id });

  if (creatorErr) {
    console.error("[api/family/threads] Failed to add creator to chat_members", {
      userId: user.id,
      message: creatorErr.message,
      code: creatorErr.code,
      details: creatorErr.details,
    });
    await adminSupabase.from("chats").delete().eq("id", thread.id);
    return new Response("Failed to create thread", { status: 500 });
  }

  // Batch insert remaining members (best-effort — creator is already in,
  // so the thread is usable even if some other member IDs fail).
  const otherMemberIds = (
    body.memberIds?.length
      ? body.memberIds
      : await getAllActiveMemberIds(adminSupabase)
  ).filter((id) => id !== user.id);

  if (otherMemberIds.length > 0) {
    const { error: membersErr } = await adminSupabase
      .from("chat_members")
      .insert(otherMemberIds.map((userId) => ({ chat_id: thread.id, user_id: userId })));

    if (membersErr) {
      console.error("[api/family/threads] Failed to add some members (non-fatal)", {
        message: membersErr.message,
        code: membersErr.code,
        details: membersErr.details,
      });
    }
  }

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
