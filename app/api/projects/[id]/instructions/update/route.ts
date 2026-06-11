import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logInstructionsWrite } from "@/lib/projects/instructionsAudit";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Automatic instructions updater, fired on project-chat unmount.
//
// APPEND-ONLY BY DESIGN. A previous version asked the model to return the
// full rewritten instructions (max_tokens 1024) and silently overwrote the
// row — a long instruction set got truncated mid-list and both output specs
// and the verification rule were lost (CPS incident). The model now returns
// only a short addendum (or NO_CHANGE); the write is always
// current + "\n\n" + addendum, guarded so it can never shrink the
// instructions, and every write is audit-logged.

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

  let addendum: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You maintain a project's standing instructions. The current instructions are shown for context — you can NOT rewrite them; they are append-only.

Current instructions:
${currentInstructions || "(none)"}

Recent conversation:
${conversationText}

If the conversation established a NEW durable rule or fact that should permanently change behavior in this project and is not already covered above, reply with ONLY a short addendum (a heading and/or a few lines) to append to the instructions. Do not repeat or restate anything already present. If nothing new and durable emerged, reply with exactly: NO_CHANGE`,
        },
      ],
    });

    addendum =
      response.content[0].type === "text" ? response.content[0].text.trim() : "NO_CHANGE";
  } catch (err) {
    console.error("[instructions/update] Anthropic error:", err);
    return new Response("OK", { status: 200 });
  }

  if (!addendum || addendum === "NO_CHANGE" || addendum.includes("NO_CHANGE")) {
    return new Response("OK", { status: 200 });
  }

  const newInstructions = currentInstructions
    ? `${currentInstructions}\n\n${addendum}`
    : addendum;

  // Structural guard: an instructions write may never shrink the text. With
  // append-only construction this always holds — the check is a tripwire in
  // case the write path changes.
  if (newInstructions.length < currentInstructions.length) {
    console.error(
      `[instructions/update] BLOCKED shrinking write: project=${id} oldLen=${currentInstructions.length} newLen=${newInstructions.length}`
    );
    return new Response("OK", { status: 200 });
  }

  const adminSupabase = createServiceRoleClient();
  const { error: writeErr } = await adminSupabase
    .from("projects")
    .update({ instructions: newInstructions })
    .eq("id", id);

  if (!writeErr) {
    await logInstructionsWrite({
      projectId: id,
      chatId: body.chatId,
      source: "auto",
      oldLength: currentInstructions.length,
      newLength: newInstructions.length,
    });
  }

  return new Response("OK", { status: 200 });
}
