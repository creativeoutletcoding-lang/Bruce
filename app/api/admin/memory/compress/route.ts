import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { user_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  const { data: memories } = await admin
    .from("memory")
    .select("id, content, tier, relevance_score, category, last_accessed, created_at")
    .eq("user_id", body.user_id)
    .eq("tier", "active")
    .order("relevance_score", { ascending: false });

  if (!memories || memories.length < 5) {
    return NextResponse.json({ archived: 0, message: "Not enough active memories to compress" });
  }

  const memoryList = memories
    .map((m, i) => `${i + 1}. [score:${m.relevance_score}] ${m.content}`)
    .join("\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Review these active memory entries for a user. Identify the line numbers of memories that should be archived — ones that are redundant, outdated, low-value, or superseded by other entries.

Return only a comma-separated list of line numbers to archive (e.g. "3,7,12"). If none should be archived, return NONE.

Memories:
${memoryList}`,
        },
      ],
    });

    raw = response.content[0].type === "text" ? response.content[0].text.trim() : "NONE";
  } catch {
    return NextResponse.json({ error: "Compression failed" }, { status: 500 });
  }

  if (raw === "NONE" || !raw) {
    return NextResponse.json({ archived: 0, message: "No memories flagged for archiving" });
  }

  const indicesToArchive = raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < memories.length);

  if (indicesToArchive.length === 0) {
    return NextResponse.json({ archived: 0, message: "No valid indices returned" });
  }

  const idsToArchive = indicesToArchive.map((i) => memories[i].id);

  const { error } = await admin
    .from("memory")
    .update({ tier: "archive" })
    .in("id", idsToArchive);

  if (error) {
    return NextResponse.json({ error: "Failed to archive memories" }, { status: 500 });
  }

  return NextResponse.json({ archived: idsToArchive.length });
}
