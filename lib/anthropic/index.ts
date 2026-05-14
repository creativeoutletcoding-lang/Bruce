// Anthropic helpers — memory assembly, system prompts, image generation block
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

// Applied to all chat contexts
const TOOL_CALL_DISCIPLINE = `**Tool call discipline:** If you commit to performing an action in a response, execute it in that same response turn — do not state what you will do and defer execution to a later turn. Confirm and act simultaneously. If a tool call fails, say so explicitly rather than silently deferring.`;

// Shared between multi-member project and family chat builders
const PARTICIPATION_RULE = `You are a participant, not the default responder. The determining factor is who the message is ADDRESSED TO — not whether your name appears in it.

RESPOND — message is addressed to you:
- Opens with "Bruce" or "@bruce"
- Contains a direct question or instruction to you
- Is not addressed to any specific person

STAY SILENT — message is directed at another member:
- Opens with or is primarily addressed to another member by name ("Laurianne what do you think", "Jake can you check this")
- Your name appears incidentally but another member is the primary addressee ("before Bruce makes the list", "ask Bruce later", "Laurianne what do you think before Bruce does X")

If another member is the primary target, stay completely silent — no acknowledgment, no stepping-back comment, nothing. Wait to be directly addressed again.`;

// Plain prose formatting for group contexts (multi-member project, family)
const GROUP_FORMAT = `Plain prose only. No bullets, numbered lists, bold, italic, headers, or markdown tables. Write lists as sentences. Two to four sentences per response unless more is genuinely needed.`;

// Richer formatting allowed in solo contexts (standalone, single-member project)
const SOLO_FORMAT = `Prefer lists and prose over tables. If a table is necessary, two columns maximum — avoid wide tables, they break on mobile.`;

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
    ).then();
  }

  return { block: formatMemoryBlock(loadedItems), loadedIds };
}

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildSystemPrompt(
  userName: string,
  memoryBlock: string,
  userTimestamp: string
): string {
  const memberLayer = buildMemberLayer(userName, userTimestamp, memoryBlock);

  const context = `## Chat context

Private standalone conversation. Be concise. Do not pad or summarize back what was just said.

${TOOL_CALL_DISCIPLINE}

${SOLO_FORMAT}`;

  return [LAYER_IDENTITY, LAYER_HOUSEHOLD, memberLayer, context].join("\n\n");
}

export function buildProjectSystemPrompt(
  userName: string,
  memoryBlock: string,
  userTimestamp: string,
  project: {
    name: string;
    instructions: string;
    memberNames: string[];
    fileNames: string[];
    fileContentBlock?: string;
  }
): string {
  const memberLayer = buildMemberLayer(userName, userTimestamp, memoryBlock);

  const filesSummary =
    project.fileNames.length > 0 ? project.fileNames.join(", ") : "(none attached)";

  let projectBlock = `--- Project: ${project.name} ---
Instructions: ${project.instructions.trim() || "(none set)"}
Members: ${project.memberNames.join(", ") || "(none)"}
Files: ${filesSummary}`;

  if (project.fileContentBlock?.trim()) {
    projectBlock += `\n\n${project.fileContentBlock.trim()}`;
  }

  projectBlock += "\n---";

  const isGroup = project.memberNames.length > 1;

  const context = isGroup
    ? `## Chat context

Project workspace — group.

${projectBlock}

${PARTICIPATION_RULE}

${TOOL_CALL_DISCIPLINE}

${GROUP_FORMAT}`
    : `## Chat context

Project workspace.

${projectBlock}

${TOOL_CALL_DISCIPLINE}

${SOLO_FORMAT}`;

  return [LAYER_IDENTITY, LAYER_HOUSEHOLD, memberLayer, context].join("\n\n");
}

export function buildFamilyChatSystemPrompt(
  senderName: string,
  memoryBlock: string,
  userTimestamp: string
): string {
  const memberLayer = buildMemberLayer(senderName, userTimestamp, memoryBlock);

  const context = `## Chat context

Family group chat.

${PARTICIPATION_RULE}

${TOOL_CALL_DISCIPLINE}

${GROUP_FORMAT}

Three-tier rule: Low stakes (log, note, simple add) → act silently. Medium stakes (update a doc, schedule something) → confirm first: "I can do X — want me to go ahead?" High stakes (external writes, deletions, irreversible) → always ask. No exceptions.

Tone: no filler phrases. No deflecting to specific members. When the action speaks for itself, stop. Emotional messages: one or two sentences, warm, not performative.`;

  return [LAYER_IDENTITY, LAYER_HOUSEHOLD, memberLayer, context].join("\n\n");
}

// ── Tool blocks ───────────────────────────────────────────────────────────────

export const IMAGE_SYSTEM_BLOCK = `

## Image generation

You can generate images at two quality levels. When the user asks for an image, a picture, a photo, artwork, a drawing, or anything visual, respond with ONLY the image_request tag and nothing else — no text before, no text after, no commentary, no confirmation:

<image_request>{"prompt": "detailed prompt here", "quality": "standard"}</image_request>

That is your entire response. Do not add any words.

Use quality "hd" when the user explicitly asks for HD, high quality, high res, detailed, or best quality. Use "standard" for everything else.

Write the prompt as if describing the image to a professional photographer or artist — specific, visual, detailed. Include lighting, style, composition, subject matter, and color palette. Do not use vague language. Do not generate images unless explicitly asked or clearly implied.`;

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

A single brief sentence after the final complete block is acceptable for a summary.`;

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

export function generateChatTitle(message: string): string {
  return message.replace(/\n/g, " ").trim().substring(0, 40);
}
