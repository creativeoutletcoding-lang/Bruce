import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { classifyMemory, buildMemberCombination, HAIKU_MODEL } from "@/lib/anthropic";

const CATEGORIES = new Set(["professional", "preference", "personal", "context"]);

// Parse a "category: memory text" line from the extraction model. Falls back
// to keyword classification when the model omits or mangles the prefix.
function parseMemoryLine(line: string): { category: string; content: string } {
  const match = /^(professional|preference|personal|context)\s*:\s*(.+)$/i.exec(line);
  if (match && CATEGORIES.has(match[1].toLowerCase())) {
    return { category: match[1].toLowerCase(), content: match[2].trim() };
  }
  return { category: classifyMemory(line), content: line };
}
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let chatId: string;
  try {
    const body = await request.json();
    chatId = body.chatId;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!chatId) return new Response("chatId required", { status: 400 });

  const adminSupabase = createServiceRoleClient();

  // Load chat metadata
  const { data: chat } = await adminSupabase
    .from("chats")
    .select("id, type, owner_id, project_id")
    .eq("id", chatId)
    .single();

  if (!chat) return new Response("Chat not found", { status: 404 });

  const chatType = chat.type as string;
  const projectId = chat.project_id as string | null;

  // Determine member IDs and project isolation setting
  let memberIds: string[] = [];
  let projectIsolateMemory = false;

  if (projectId) {
    const [{ data: projMembers }, { data: projData }] = await Promise.all([
      adminSupabase.from("project_members").select("user_id").eq("project_id", projectId),
      adminSupabase.from("projects").select("isolate_memory").eq("id", projectId).single(),
    ]);
    memberIds = ((projMembers ?? []) as { user_id: string }[]).map((m) => m.user_id);
    projectIsolateMemory = (projData as { isolate_memory: boolean } | null)?.isolate_memory ?? false;
  } else if (chatType === "family_group" || chatType === "family_thread" || chatType === "group") {
    const { data: chatMembers } = await adminSupabase
      .from("chat_members")
      .select("user_id")
      .eq("chat_id", chatId);
    memberIds = ((chatMembers ?? []) as { user_id: string }[]).map((m) => m.user_id);
  } else {
    // Standalone private chat — single owner
    memberIds = [chat.owner_id as string];
  }

  const isMultiMember = memberIds.length > 1;

  // Fetch all messages for the chat
  const { data: messages } = await adminSupabase
    .from("messages")
    .select("role, content, sender_id")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (!messages || messages.length < 2) return Response.json({ generated: 0 });

  // Build name map for transcript
  const memberNameMap: Record<string, string> = {};
  if (memberIds.length > 0) {
    const { data: profiles } = await adminSupabase
      .from("users")
      .select("id, name")
      .in("id", memberIds);
    for (const p of profiles ?? []) {
      memberNameMap[p.id as string] = p.name as string;
    }
  }
  // Ensure the calling user is in the map
  if (!memberNameMap[user.id]) {
    const { data: me } = await adminSupabase.from("users").select("name").eq("id", user.id).single();
    memberNameMap[user.id] = (me as { name: string } | null)?.name ?? "User";
  }

  // Build transcript
  const transcript = messages
    .map((m) => {
      const sender = m.sender_id
        ? (memberNameMap[m.sender_id as string] ?? "Member")
        : "Bruce";
      return `${sender}: ${m.content}`;
    })
    .join("\n\n");

  const memberNames = memberIds.map((id) => memberNameMap[id] ?? id);
  const subjectDescription = isMultiMember
    ? memberNames.join(" and ")
    : (memberNames[0] ?? "the user");

  const exampleName = memberNames[0] ?? "Jake";
  const exampleName2 = memberNames[1] ?? "Nana";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Review this conversation and identify facts, preferences, decisions, situations, or context worth remembering about ${subjectDescription}.

Write each memory as a clean, concise statement in the third person. ${isMultiMember ? `Reference people by name. Example: "preference: ${exampleName} and ${exampleName2} prefer to meet on Thursdays."` : `Example: "preference: ${exampleName} prefers direct responses with no preamble."`}

Return only memories that clear a meaningful threshold — not every detail, only things genuinely useful to know in future conversations.

Format: one memory per line, prefixed with its category and a colon. Category must be one of: professional, preference, personal, context. No bullets, no numbering, no preamble.

If nothing is worth remembering, return the single word: NONE

${transcript}`,
        },
      ],
    });
    raw = response.content[0].type === "text" ? response.content[0].text : "NONE";
  } catch (err) {
    console.error("[memory/generate] Anthropic error:", err);
    return new Response("Memory generation failed", { status: 500 });
  }

  if (raw.trim() === "NONE") return Response.json({ generated: 0 });

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "NONE");

  if (lines.length === 0) return Response.json({ generated: 0 });

  let generated = 0;

  if (!isMultiMember) {
    // Private memory — scoped to the single member
    const ownerId = memberIds[0] ?? user.id;
    for (const line of lines) {
      const { category, content } = parseMemoryLine(line);
      const { data: existing } = await adminSupabase
        .from("memory")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("type", "private")
        .eq("content", content)
        .maybeSingle();
      if (existing) continue;

      const { error } = await adminSupabase.from("memory").insert({
        owner_id: ownerId,
        type: "private",
        content,
        tier: "active",
        relevance_score: 50,
        category,
      });
      if (!error) generated++;
    }
  } else {
    // Shared memory — scoped to the member combination
    const combo = buildMemberCombination(memberIds);
    const memProjectId = projectIsolateMemory ? projectId : null;

    for (const line of lines) {
      const { category, content } = parseMemoryLine(line);
      const query = adminSupabase
        .from("memory")
        .select("id")
        .eq("member_combination", combo)
        .eq("type", "shared")
        .eq("content", content);

      const { data: existing } = memProjectId
        ? await query.eq("project_id", memProjectId).maybeSingle()
        : await query.is("project_id", null).maybeSingle();

      if (existing) continue;

      const { error } = await adminSupabase.from("memory").insert({
        type: "shared",
        member_combination: combo,
        project_id: memProjectId,
        content,
        tier: "active",
        relevance_score: 50,
        category,
      });
      if (!error) generated++;
    }
  }

  return Response.json({ generated });
}
