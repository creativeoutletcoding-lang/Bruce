import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { classifyMemory } from "@/lib/anthropic";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  let chatId: string;
  try {
    const body = await request.json();
    chatId = body.chatId;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!chatId) {
    return new Response("chatId required", { status: 400 });
  }

  // Fetch all messages for the chat
  const { data: messages } = await supabase
    .from("messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (!messages || messages.length < 2) {
    return Response.json({ generated: 0 });
  }

  const transcript = messages
    .map((m) => `${m.role === "user" ? "Jake" : "Bruce"}: ${m.content}`)
    .join("\n\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Review this conversation and identify facts, preferences, situations, or context worth remembering about Jake.

Write each memory as a clean, concise statement in the third person. Example: "Jake prefers direct responses with no preamble."

Return only memories that clear a meaningful threshold — not every detail, only things genuinely useful to know in future conversations.

Format: one memory per line, no bullets, no numbering, no preamble.

If nothing is worth remembering, return the single word: NONE

${transcript}`,
        },
      ],
    });

    raw =
      response.content[0].type === "text" ? response.content[0].text : "NONE";
  } catch (err) {
    console.error("[memory/generate] Anthropic error:", err);
    return new Response("Memory generation failed", { status: 500 });
  }

  if (raw.trim() === "NONE") {
    return Response.json({ generated: 0 });
  }

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && l !== "NONE");

  if (lines.length === 0) {
    return Response.json({ generated: 0 });
  }

  const adminSupabase = createServiceRoleClient();
  let generated = 0;

  for (const content of lines) {
    // Skip duplicates
    const { data: existing } = await adminSupabase
      .from("memory")
      .select("id")
      .eq("user_id", user.id)
      .eq("content", content)
      .maybeSingle();

    if (existing) continue;

    const { error } = await adminSupabase.from("memory").insert({
      user_id: user.id,
      content,
      tier: "active",
      relevance_score: 50,
      category: classifyMemory(content),
    });

    if (!error) generated++;
  }

  return Response.json({ generated });
}
