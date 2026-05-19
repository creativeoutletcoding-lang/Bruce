import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

interface ChatRow { id: string; title: string | null; project_id: string | null }
interface MessageRow { content: string; role: string; created_at: string; chat_id: string }
interface MemberRow { chat_id: string }
interface ProjectMemberRow { project_id: string }

function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.7 ? cut.slice(0, lastSpace) : cut) + "…";
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const scope = searchParams.get("scope") ?? "";
  const projectId = searchParams.get("project_id") ?? null;

  if (!q || !["private", "project", "family"].includes(scope)) {
    return Response.json([]);
  }

  // Resolve eligible chat IDs based on scope — using RLS client so only
  // chats the user has access to are returned.
  let chatIds: string[] = [];

  if (scope === "private") {
    const { data } = await supabase
      .from("chats")
      .select("id")
      .eq("owner_id", user.id)
      .eq("type", "private")
      .is("project_id", null);
    chatIds = (data as ChatRow[] | null ?? []).map((c) => c.id);
  } else if (scope === "project") {
    // Search all project chats the user is a member of (no specific project required)
    const { data: memberships } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id);
    const memberProjectIds = (memberships as ProjectMemberRow[] | null ?? []).map((r) => r.project_id);
    if (memberProjectIds.length === 0) return Response.json([]);

    const queryBase = projectId
      ? supabase.from("chats").select("id, project_id").eq("project_id", projectId).eq("type", "project")
      : supabase.from("chats").select("id, project_id").in("project_id", memberProjectIds).eq("type", "project");
    const { data } = await queryBase;
    chatIds = (data as ChatRow[] | null ?? []).map((c) => c.id);
  } else {
    // family
    const { data: memberRows } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", user.id);
    const memberChatIds = (memberRows as MemberRow[] | null ?? []).map((r) => r.chat_id);
    if (memberChatIds.length === 0) return Response.json([]);
    const { data } = await supabase
      .from("chats")
      .select("id")
      .in("id", memberChatIds)
      .eq("type", "family");
    chatIds = (data as ChatRow[] | null ?? []).map((c) => c.id);
  }

  if (chatIds.length === 0) return Response.json([]);

  const { data: messages } = await supabase
    .from("messages")
    .select("content, role, created_at, chat_id")
    .in("chat_id", chatIds)
    .in("role", ["user", "assistant"])
    .textSearch("content", q, { type: "plain", config: "english" })
    .order("created_at", { ascending: false })
    .limit(20);

  if (!messages || (messages as MessageRow[]).length === 0) return Response.json([]);

  const matchedChatIds = [...new Set((messages as MessageRow[]).map((m) => m.chat_id))];
  const { data: chats } = await supabase
    .from("chats")
    .select("id, title, project_id")
    .in("id", matchedChatIds);
  const chatMap = Object.fromEntries(
    (chats as ChatRow[] | null ?? []).map((c) => [c.id, c])
  );

  const results = (messages as MessageRow[]).map((m) => {
    const chat = chatMap[m.chat_id];
    return {
      chat_id: m.chat_id,
      chat_title: chat?.title ?? "Untitled",
      project_id: chat?.project_id ?? null,
      excerpt: truncateAtWord(m.content ?? "", 200),
      matched_at: m.created_at,
      role: m.role as "user" | "assistant",
    };
  });

  return Response.json(results);
}
