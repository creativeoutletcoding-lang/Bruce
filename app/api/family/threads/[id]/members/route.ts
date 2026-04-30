import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { NextRequest } from "next/server";

// POST /api/family/threads/[id]/members — add a user to a thread
// Any current thread member can add someone new.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;

  let body: { userId: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.userId) return new Response("userId required", { status: 400 });

  const adminSupabase = createServiceRoleClient();

  // Verify requester is already a thread member
  const { data: membership } = await adminSupabase
    .from("chat_members")
    .select("id")
    .eq("chat_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) return new Response("Not a thread member", { status: 403 });

  // Verify thread exists and is a family_thread
  const { data: thread } = await adminSupabase
    .from("chats")
    .select("id, title")
    .eq("id", id)
    .eq("type", "family_thread")
    .is("deleted_at", null)
    .maybeSingle();

  if (!thread) return new Response("Thread not found", { status: 404 });

  // Upsert to handle duplicate gracefully
  const { error } = await adminSupabase
    .from("chat_members")
    .upsert({ chat_id: id, user_id: body.userId }, { onConflict: "chat_id,user_id" });

  if (error) {
    console.error("[api/family/threads/[id]/members] Add member failed:", error);
    return new Response("Failed to add member", { status: 500 });
  }

  const adderName = (await adminSupabase
    .from("users")
    .select("name")
    .eq("id", user.id)
    .single()
    .then((r) => r.data?.name)) ?? "Someone";

  const threadTitle = (thread as { id: string; title: string }).title ?? "a thread";

  await notifyUser({
    userId: body.userId,
    senderId: user.id,
    title: `Added to thread: ${threadTitle}`,
    body: `${adderName} added you to "${threadTitle}"`,
    type: "thread_added",
    url: `https://heybruce.app/family/threads/${id}`,
    suppressIfActiveInChatId: id,
  });

  return new Response(null, { status: 204 });
}
