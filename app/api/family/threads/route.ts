import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { NextRequest } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  // Use service role to bypass RLS, then filter to threads where the
  // authenticated user has a chat_members row. The anon client's RLS policy on
  // chat_members is self-referential and blocks newly-created rows before the
  // policy's own EXISTS subquery can see them.
  const adminSupabase = createServiceRoleClient();

  const { data: memberRows } = await adminSupabase
    .from("chat_members")
    .select("chat_id")
    .eq("user_id", user.id);

  const chatIds = (memberRows ?? []).map((r: { chat_id: string }) => r.chat_id);
  if (chatIds.length === 0) return Response.json([]);

  const { data: threads } = await adminSupabase
    .from("chats")
    .select("id, title, last_message_at")
    .eq("type", "family_thread")
    .in("id", chatIds)
    .order("last_message_at", { ascending: false })
    .limit(30);

  if (!threads || threads.length === 0) return Response.json([]);

  // Batch-fetch members for all threads in two queries (not N+1)
  const { data: threadMemberRows } = await adminSupabase
    .from("chat_members")
    .select("chat_id, user_id")
    .in("chat_id", threads.map((t: { id: string }) => t.id));

  const allMemberUserIds = [
    ...new Set((threadMemberRows ?? []).map((m: { user_id: string }) => m.user_id)),
  ];

  const { data: userRows } = allMemberUserIds.length > 0
    ? await adminSupabase
        .from("users")
        .select("id, name, avatar_url")
        .in("id", allMemberUserIds)
    : { data: [] };

  const userMap: Record<string, { id: string; name: string; avatar_url: string | null }> = {};
  (userRows ?? []).forEach((u: { id: string; name: string; avatar_url: string | null }) => {
    userMap[u.id] = u;
  });

  const result = threads.map((thread: { id: string; title: string; last_message_at: string }) => ({
    id: thread.id,
    title: thread.title,
    last_message_at: thread.last_message_at,
    members: (threadMemberRows ?? [])
      .filter((m: { chat_id: string }) => m.chat_id === thread.id)
      .map((m: { user_id: string }) => userMap[m.user_id])
      .filter(Boolean)
      .slice(0, 4),
  }));

  return Response.json(result);
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
    .select("id, title, last_message_at")
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
  // unusable — delete it and surface the error.
  const { error: creatorErr } = await adminSupabase
    .from("chat_members")
    .insert({ chat_id: thread.id, user_id: user.id });

  if (creatorErr) {
    console.error("[api/family/threads] Failed to add creator to chat_members", {
      userId: user.id,
      chatId: thread.id,
      message: creatorErr.message,
      code: creatorErr.code,
    });
    await adminSupabase.from("chats").delete().eq("id", thread.id);
    return new Response("Failed to create thread", { status: 500 });
  }

  // Batch insert remaining members.
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
      console.error("[api/family/threads] Failed to add other members", {
        chatId: thread.id,
        message: membersErr.message,
        code: membersErr.code,
      });
      return new Response("Failed to create thread", { status: 500 });
    }
  }

  const creatorName = (await adminSupabase
    .from("users")
    .select("name")
    .eq("id", user.id)
    .single()
    .then((r) => r.data?.name)) ?? "Someone";

  await Promise.all(
    otherMemberIds.map((recipientId) =>
      notifyUser({
        userId: recipientId,
        senderId: user.id,
        title: `New thread: ${name}`,
        body: `${creatorName} added you to "${name}"`,
        type: "thread_added",
        url: `https://heybruce.app/family/threads/${thread.id}`,
        suppressIfActiveInChatId: thread.id,
      })
    )
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
