import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { assembleMemoryBlock, LAYER_IDENTITY, LAYER_HOUSEHOLD, buildMemberLayer } from "@/lib/anthropic";
import { NextRequest } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export const runtime = "nodejs";

function loadTechContext(): string {
  try {
    const claudeMd = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf-8");
    return claudeMd.replace(/(key|secret|token|password)\s*[:=]\s*\S+/gi, "$1: [MASKED]");
  } catch {
    return "(CLAUDE.md not found)";
  }
}

function getGitState(): { gitLog: string; gitDiff: string } {
  let gitLog = "";
  let gitDiff = "";
  try {
    gitLog = execSync("git log --oneline -10", { encoding: "utf-8", cwd: process.cwd() }).trim();
  } catch {
    // not a git repo or no commits
  }
  try {
    gitDiff = execSync("git diff --stat HEAD~1", { encoding: "utf-8", cwd: process.cwd() }).trim();
  } catch {
    // no previous commit or diff unavailable
  }
  return { gitLog, gitDiff };
}

function buildDevSystemPrompt(
  userName: string,
  memoryBlock: string,
  userTimestamp: string
): string {
  const memberLayer = buildMemberLayer(userName, userTimestamp, memoryBlock);

  const devSituational = `## Bruce Dev workspace

You are currently in the Bruce Dev admin workspace. This is Jake's technical workspace for building, debugging, and improving Bruce. Respond as a technical peer with full knowledge of your own architecture. Be direct and precise.`;

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
    "ADMIN_EMAIL",
    "PERPLEXITY_API_KEY",
    "FAMILY_CALENDAR_REFRESH_TOKEN",
    "FAMILY_CALENDAR_TIMEZONE",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "MEMBER_EMAIL_LAURIANNE",
    "MEMBER_EMAIL_JOCELYNN",
    "MEMBER_EMAIL_NANA",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  ];

  const envStatus = envVars
    .map((k) => `${k}: ${process.env[k] ? "SET" : "MISSING"}`)
    .join("\n");

  const { gitLog, gitDiff } = getGitState();

  const gitBlock = `## Recent Git Activity

Last 10 commits:
${gitLog || "(no commits yet)"}

Files changed in last commit:
${gitDiff || "(no diff available)"}`;

  const techContext = loadTechContext();

  return [
    LAYER_IDENTITY,
    LAYER_HOUSEHOLD,
    memberLayer,
    devSituational,
    `## Environment Variable Status (values masked)\n\n${envStatus}`,
    gitBlock,
    `## Full Technical Context (CLAUDE.md)\n\n${techContext}`,
  ].join("\n\n");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role, name")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

  let body: { message: string };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.message?.trim()) return new Response("Message required", { status: 400 });

  const serviceSupabase = createServiceRoleClient();

  const { data: historyRows } = await serviceSupabase
    .from("admin_dev_messages")
    .select("role, content")
    .order("created_at", { ascending: true })
    .limit(40);

  const dbHistory = (historyRows ?? []) as Array<{ role: "user" | "assistant"; content: string }>;

  const { block: memoryBlock } = await assembleMemoryBlock(supabase, user.id);

  const userName = (profile.name as string | null) ?? "Jake";
  const userTimestamp = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "full",
    timeStyle: "short",
  });

  const systemPrompt = buildDevSystemPrompt(userName, memoryBlock, userTimestamp);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const messages: Anthropic.Messages.MessageParam[] = [
    ...dbHistory,
    { role: "user", content: body.message },
  ];

  const userMessage = body.message;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullResponse = "";
      try {
        const anthropicStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
        });

        anthropicStream.on("text", (text) => {
          fullResponse += text;
          controller.enqueue(encoder.encode(text));
        });

        await anthropicStream.finalMessage();

        await serviceSupabase.from("admin_dev_messages").insert([
          { role: "user", content: userMessage },
          { role: "assistant", content: fullResponse },
        ]);

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
