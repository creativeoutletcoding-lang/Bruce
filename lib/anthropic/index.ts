// Anthropic helpers — memory assembly, system prompts, image generation block
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Fast/cheap model for structured side-tasks (chat titles, memory extraction,
// the family engagement gate). Conversation itself always uses the member's
// preferred model — never this one.
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// ── Memory assembly constants ─────────────────────────────────────────────────

const MAX_CORE = 20;
const MAX_ACTIVE = 15;
const MAX_WORDS = 500;

// ── Member combination helper ─────────────────────────────────────────────────

export function buildMemberCombination(userIds: string[]): string {
  return [...userIds].sort().join(":");
}

const CATEGORY_ORDER = ["professional", "preference", "personal", "context"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  professional: "Professional",
  preference: "Preferences",
  personal: "Personal",
  context: "Context",
};

// ── Shared system prompt layers ───────────────────────────────────────────────

export const LAYER_IDENTITY = `You are Bruce — the Johnson family's private household AI. Built for this family specifically, not a generic assistant.

Character: calm, reliable, consistent, intelligent, caring. Never reactive. Admit when you don't know something. Connect dots across conversations. Oriented toward the family's wellbeing, not just task completion.`;

export const LAYER_HOUSEHOLD = `## The Johnson Family — Arlington, Virginia

- Jake Johnson, 36. Admin. Account executive at Foundation Insurance Group, co-owner of Capital Petsitters.
- Laurianne Johnson, 33. Full member.
- Jocelynn Johnson (Joce), 16. Treated as an adult. Full member.
- Nana, 69. Jake's mother. Co-owner of Capital Petsitters.

No accounts (context only): Elliot (8), Henry (5), Violette (5) — Jake and Laurianne's children.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getToneInstruction(name: string): string {
  const n = name.toLowerCase().trim();
  if (n === "jake" || n === "jake johnson") {
    return "Tone with Jake: technical and direct when building, professional and efficient for business topics. Always peer-level — no hand-holding.";
  }
  if (n === "laurianne") {
    return "Tone with Laurianne: conversational, warm, collaborative.";
  }
  if (n === "jocelynn" || n === "joce") {
    return "Tone with Jocelynn: encouraging, peer-like, never condescending.";
  }
  if (n === "nana") {
    return "Tone with Nana: clear, patient, straightforward — no unnecessary technical language.";
  }
  return "Tone: warm and direct.";
}

function formatMemoryBlock(
  items: Array<{ content: string; category: string | null }>
): string {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const cat = item.category ?? "context";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item.content);
  }
  const parts: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    const entries = groups.get(cat);
    if (entries?.length) {
      parts.push(`**${CATEGORY_LABELS[cat]}**\n${entries.join("\n")}`);
    }
  }
  for (const [cat, entries] of groups) {
    if (!(CATEGORY_ORDER as readonly string[]).includes(cat) && entries.length) {
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      parts.push(`**${label}**\n${entries.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

// ── Layer 3 — Member context ──────────────────────────────────────────────────

export function buildMemberLayer(
  userName: string,
  userTimestamp: string,
  memoryBlock: string
): string {
  const tone = getToneInstruction(userName);

  let layer = `## Current session

You are talking with ${userName}.
${tone}
The current date and time is ${userTimestamp}.`;

  if (memoryBlock.trim()) {
    layer += `\n\n## What Bruce knows about ${userName}\n\n${memoryBlock}`;
  }

  return layer;
}

// ── Memory assembly ───────────────────────────────────────────────────────────

type MemoryRow = {
  id: string;
  content: string;
  category: string | null;
  relevance_score: number;
};

export async function assembleMemoryBlock(
  _supabase: SupabaseClient,
  userId: string,
  context?: {
    memberCombination?: string;
    projectId?: string;
    isolateMemory?: boolean;
  }
): Promise<{ block: string; loadedIds: string[] }> {
  const serviceRole = createServiceRoleClient();

  const [{ data: privateCore }, { data: privateActive }] = await Promise.all([
    serviceRole
      .from("memory")
      .select("id, content, category, relevance_score")
      .eq("owner_id", userId)
      .eq("type", "private")
      .eq("tier", "core")
      .order("created_at", { ascending: true })
      .limit(MAX_CORE),
    serviceRole
      .from("memory")
      .select("id, content, category, relevance_score")
      .eq("owner_id", userId)
      .eq("type", "private")
      .eq("tier", "active")
      .order("relevance_score", { ascending: false })
      .limit(MAX_ACTIVE),
  ]);

  let sharedCore: MemoryRow[] = [];
  let sharedActive: MemoryRow[] = [];
  let isolatedCore: MemoryRow[] = [];
  let isolatedActive: MemoryRow[] = [];

  if (context?.memberCombination) {
    const combo = context.memberCombination;

    const [scRes, saRes] = await Promise.all([
      serviceRole
        .from("memory")
        .select("id, content, category, relevance_score")
        .eq("member_combination", combo)
        .eq("type", "shared")
        .is("project_id", null)
        .eq("tier", "core")
        .order("created_at", { ascending: true })
        .limit(MAX_CORE),
      serviceRole
        .from("memory")
        .select("id, content, category, relevance_score")
        .eq("member_combination", combo)
        .eq("type", "shared")
        .is("project_id", null)
        .eq("tier", "active")
        .order("relevance_score", { ascending: false })
        .limit(MAX_ACTIVE),
    ]);
    sharedCore = (scRes.data ?? []) as MemoryRow[];
    sharedActive = (saRes.data ?? []) as MemoryRow[];

    if (context.isolateMemory && context.projectId) {
      const [icRes, iaRes] = await Promise.all([
        serviceRole
          .from("memory")
          .select("id, content, category, relevance_score")
          .eq("member_combination", combo)
          .eq("type", "shared")
          .eq("project_id", context.projectId)
          .eq("tier", "core")
          .order("created_at", { ascending: true })
          .limit(MAX_CORE),
        serviceRole
          .from("memory")
          .select("id, content, category, relevance_score")
          .eq("member_combination", combo)
          .eq("type", "shared")
          .eq("project_id", context.projectId)
          .eq("tier", "active")
          .order("relevance_score", { ascending: false })
          .limit(MAX_ACTIVE),
      ]);
      isolatedCore = (icRes.data ?? []) as MemoryRow[];
      isolatedActive = (iaRes.data ?? []) as MemoryRow[];
    }
  }

  const allCore: MemoryRow[] = [
    ...((privateCore ?? []) as MemoryRow[]),
    ...(sharedCore ?? []),
    ...(isolatedCore ?? []),
  ];
  const allActive: MemoryRow[] = [
    ...((privateActive ?? []) as MemoryRow[]),
    ...(sharedActive ?? []),
    ...(isolatedActive ?? []),
  ];

  const loadedItems: Array<MemoryRow> = [];
  let wordCount = 0;

  for (const m of allCore) {
    const words = countWords(m.content);
    if (wordCount + words > MAX_WORDS) break;
    loadedItems.push(m);
    wordCount += words;
  }

  for (const m of allActive) {
    const words = countWords(m.content);
    if (wordCount + words > MAX_WORDS) break;
    loadedItems.push(m);
    wordCount += words;
  }

  const loadedIds = loadedItems.map((m) => m.id);

  if (loadedItems.length > 0) {
    // after() keeps the function instance alive until these writes land —
    // a bare fire-and-forget can be frozen mid-flight on serverless.
    after(() =>
      Promise.all(
        loadedItems.map((m) =>
          serviceRole
            .from("memory")
            .update({
              relevance_score: Math.min(m.relevance_score + 1, 100),
              last_accessed: new Date().toISOString(),
            })
            .eq("id", m.id)
        )
      )
    );
  }

  return { block: formatMemoryBlock(loadedItems), loadedIds };
}

// ── Tool blocks ───────────────────────────────────────────────────────────────

export const IMAGE_SYSTEM_BLOCK = `

## Image generation

You can generate images. Only call image generation when the user explicitly asks for an image, illustration, picture, photo, drawing, or artwork. Never generate an image as a response to a request for text-based content — games, quizzes, plans, documents, lists, stories, or any other deliverable that is text. The word "create" or "make" alone does not trigger image generation; the request must be unambiguously about a visual output.

When image generation is appropriate, respond with ONLY the image_request tag and nothing else — no text before, no text after, no commentary, no confirmation:

<image_request>{"prompt": "detailed prompt here", "quality": "standard"}</image_request>

That is your entire response. Do not add any words.

Use quality "hd" when the user explicitly asks for HD, high quality, high res, detailed, or best quality. Use "standard" for everything else.

Write the prompt as if describing the image to a professional photographer or artist — specific, visual, detailed. Include lighting, style, composition, subject matter, and color palette. Do not use vague language.

## Image editing

When the user has attached an image (you will see an [image_url: ...] tag in their message) and asks you to modify, transform, or edit it — use the edit_image tool instead of generate_image. Never emit an <image_request> tag when a source image is available.

Situations that must use edit_image (not generate_image):
- "Make this look like a painting / cartoon / sketch"
- "Remove the background"
- "Change the sky to sunset / add snow / make it black and white"
- "Put me in Paris" / "Add a hat" / any object addition or removal
- Any request that says "this", "it", "the image" when an image is attached

Pass the URL from the [image_url: ...] tag directly as image_url. Write the prompt as a plain English instruction describing what to change.

The edited image is saved automatically — respond with a brief confirmation after the tool returns.`;

export const IMAGE_VISION_BLOCK = `

## Media analysis

You can read documents and analyze images shared by household members. When a PDF, text file, or other document is provided, read it carefully and use it to inform your response. When an image is provided, examine it visually. Use whatever is shared as the basis for your response.`;

export const TASK_PROGRESS_SYSTEM_BLOCK = `

## Multi-step task progress

For any task with 3 or more sequential steps or tool calls, structure your work using task_progress blocks. The card replaces running commentary — do not narrate steps in text alongside it.

At task start, emit a block defining all steps:
<task_progress>{"task": "Descriptive Task Name", "steps": [{"id": "s1", "label": "Reading import file", "status": "working"}, {"id": "s2", "label": "Parsing vendors", "status": "pending"}, {"id": "s3", "label": "Writing output", "status": "pending"}]}</task_progress>

After each step completes, emit a new block with updated statuses. Mark the just-finished step "done", the next step "working", remaining "pending".

On error: set the failed step to "error" (add an "error" field with a brief message), and set all remaining steps to "cancelled".

You may add an optional "detail" field to a completed step for a short note (e.g. "27 vendors, $15,910.48 gross").

A single brief sentence after the final complete block is acceptable for a summary.

**No intermediate output during tasks.** All reasoning, calculations, and intermediate data must be processed internally — never printed to chat. Do not emit tables, row-by-row calculations, running totals, or partial results during a task. The task card is the only visible output while a task is running. After the task completes, emit only the final summary.

**Zero text during tool calls — this is absolute.** During a multi-step task your response text must be completely empty until all steps are done. Do not write anything: no calculations, no tables, no vendor lists, no reasoning, no labels like "internal" or "silent", no narration of what you are doing. Nothing. The task card handles progress visibility. Any text you emit before the final summary consumes output tokens and can cause the task to fail. Your only text output is the final summary after all tool calls complete.

**Auto-recover from "already exists" errors.** If a tool call fails because a resource already exists (e.g. a spreadsheet tab with that name already exists), do not stop or ask the user. Delete the existing resource and recreate it, then continue the task without interruption. Note the overwrite briefly in the final summary.

**Never confirm completion without executed tool results.** Do not emit a verification summary, report success, or confirm any step unless the corresponding tool call has actually been made and returned a success result in this conversation turn. Do not summarize or report results based on assumptions, memory of prior runs, or inferred state. If a tool call has not executed and returned a result in the current turn, that step has not been completed — say so instead of fabricating a summary.`;

// ── Memory utilities ──────────────────────────────────────────────────────────

export function classifyMemory(content: string): string {
  const lower = content.toLowerCase();
  if (
    lower.includes("prefer") ||
    lower.includes(" like ") ||
    lower.includes("dislike") ||
    lower.includes("enjoys") ||
    lower.includes("dislikes") ||
    lower.includes("hates") ||
    lower.includes("loves")
  )
    return "preference";
  if (
    lower.includes("work") ||
    lower.includes("job") ||
    lower.includes("professional") ||
    lower.includes("business") ||
    lower.includes("company") ||
    lower.includes("client") ||
    lower.includes("insurance") ||
    lower.includes("petsitter")
  )
    return "professional";
  if (
    lower.includes("family") ||
    lower.includes("home") ||
    lower.includes("house") ||
    lower.includes("mother") ||
    lower.includes("wife") ||
    lower.includes("son") ||
    lower.includes("daughter") ||
    lower.includes("kids") ||
    lower.includes("children")
  )
    return "personal";
  return "context";
}

// Immediate placeholder title — shown until generateSmartTitle lands.
export function generateChatTitle(message: string): string {
  return message.replace(/\n/g, " ").trim().substring(0, 40);
}

// Real title via Haiku. Called fire-and-forget alongside the response stream
// (the function instance stays alive while streaming, so the update lands
// mid-stream and the sidebar picks it up on the post-stream refresh).
export async function generateSmartTitle(message: string): Promise<string | null> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 30,
      messages: [
        {
          role: "user",
          content: `Write a 2-5 word title for a conversation that starts with this message. Output only the title — no quotes, no trailing punctuation.\n\nMessage: ${message.slice(0, 500)}`,
        },
      ],
    });
    const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
    return text ? text.replace(/^["']|["']$/g, "").slice(0, 60) : null;
  } catch {
    return null; // placeholder title stays — never block or fail the chat for a title
  }
}
