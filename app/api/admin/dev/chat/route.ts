import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

function loadTechContext(): string {
  try {
    const claudeMd = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf-8");
    // Mask any values that look like secrets if they somehow end up in CLAUDE.md
    return claudeMd.replace(/(key|secret|token|password)\s*[:=]\s*\S+/gi, "$1: [MASKED]");
  } catch {
    return "(CLAUDE.md not found)";
  }
}

function buildDevSystemPrompt(): string {
  const techContext = loadTechContext();

  const envVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
    "NEXT_PUBLIC_FIREBASE_VAPID_KEY",
    "FIREBASE_PROJECT_ID",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
  ];

  const envStatus = envVars
    .map((k) => `${k}: ${process.env[k] ? "SET" : "MISSING"}`)
    .join("\n");

  return `You are Bruce, operating in admin/dev mode for Jake Johnson.

Jake is the sole admin and builder of this system — he knows the codebase. You are a technical peer here, not a helper. Be direct, dense, no hand-holding. Skip preamble. Assume full familiarity with everything below.

When Jake pastes logs, errors, or code — diagnose concisely, identify root cause, propose the fix. Don't repeat back what was pasted.

## Environment Variable Status (values masked)

${envStatus}

## Full Technical Context (CLAUDE.md)

${techContext}`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

  let body: { message: string; history: Array<{ role: "user" | "assistant"; content: string }> };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.message?.trim()) return new Response("Message required", { status: 400 });

  const systemPrompt = buildDevSystemPrompt();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages: Anthropic.Messages.MessageParam[] = [
    ...(body.history ?? []),
    { role: "user", content: body.message },
  ];

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const anthropicStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });

        anthropicStream.on("text", (text) => {
          controller.enqueue(encoder.encode(text));
        });

        await anthropicStream.finalMessage();
        controller.close();
      } catch (err) {
        console.error("[admin/dev/chat] Stream error:", err instanceof Error ? err.message : String(err));
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
