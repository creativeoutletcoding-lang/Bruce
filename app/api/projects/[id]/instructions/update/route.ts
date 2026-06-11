import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { chatId: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.chatId) return new Response("chatId required", { status: 400 });

  // Load current project instructions (RLS ensures user is a member)
  const { data: project } = await supabase
    .from("projects")
    .select("instructions")
    .eq("id", id)
    .single();

  if (!project) return new Response("Not found", { status: 404 });

  // Load last 10 messages of the conversation
  const { data: messages } = await supabase
    .from("messages")
    .select("role, content")
    .eq("chat_id", body.chatId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!messages || messages.length === 0) return new Response("OK", { status: 200 });

  const conversationText = [...messages]
    .reverse()
    .map((m) => `${m.role === "user" ? "User" : "Bruce"}: ${m.content}`)
    .join("\n\n");

  const currentInstructions = (project.instructions as string) || "";

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let newInstructions: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are updating project instructions. Current instructions: ${currentInstructions || "(none)"}.

Recent conversation:
${conversationText}

If something important emerged that should be permanently reflected in how you behave in this project, return updated instructions. If nothing meaningful changed, return the original instructions unchanged. Return only the instructions text, nothing else.`,
        },
      ],
    });

    newInstructions =
      response.content[0].type === "text" ? response.content[0].text.trim() : currentInstructions;
  } catch (err) {
    console.error("[instructions/update] Anthropic error:", err);
    return new Response("OK", { status: 200 });
  }

  if (newInstructions && newInstructions !== currentInstructions) {
    const adminSupabase = createServiceRoleClient();
    await adminSupabase
      .from("projects")
      .update({ instructions: newInstructions })
      .eq("id", id);
  }

  return new Response("OK", { status: 200 });
}
