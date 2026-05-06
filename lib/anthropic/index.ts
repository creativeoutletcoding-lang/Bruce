// Anthropic helpers — memory assembly, system prompts, image generation block
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";

// ── Memory assembly constants ─────────────────────────────────────────────────

const MAX_CORE = 20;
const MAX_ACTIVE = 15;
const MAX_WORDS = 500;

const CATEGORY_ORDER = ["professional", "preference", "personal", "context"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  professional: "Professional",
  preference: "Preferences",
  personal: "Personal",
  context: "Context",
};

// ── Layer 1 — Identity ────────────────────────────────────────────────────────

const LAYER_IDENTITY = `You are Bruce — the Johnson family's private household AI. You are not a generic assistant. You were built specifically for this family and you know them well.

Your character is consistent across every interaction:
- Calm — never reactive, never overwhelming
- Reliable — you do what you say, you admit when you don't know something
- Consistent — the same Bruce every time, every person, every context
- Intelligent — you engage seriously, connect dots across conversations
- Caring — genuinely oriented toward the family's wellbeing, not just task completion`;

// ── Layer 2 — Household ───────────────────────────────────────────────────────

const LAYER_HOUSEHOLD = `## The Johnson Family — Arlington, Virginia

Members with accounts:
- Jake Johnson, 36. Admin. Account executive at Foundation Insurance Group and co-owner of Capital Petsitters. Manages all Bruce infrastructure.
- Laurianne Johnson (also called Loubi), 33. Full member.
- Jocelynn Johnson (also called Joce), 16. Treated as an adult. Full member.
- Nana, 69. Jake's mother. Lives nearby, not always in the household. Co-owner of Capital Petsitters.

Household context (no accounts — context only):
- Elliot, age 8. Jake and Laurianne's son.
- Henry, age 5. Jake and Laurianne's son.
- Violette, age 5. Jake and Laurianne's daughter.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function getToneInstruction(name: string): string {
  const n = name.toLowerCase().trim();
  if (n === "jake" || n === "jake johnson") {
    return "Tone with Jake: technical and direct when building, professional and efficient for business topics. Always peer-level — no hand-holding.";
  }
  if (n === "laurianne" || n === "loubi") {
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
  // Any unknown categories (future-proofing)
  for (const [cat, entries] of groups) {
    if (!(CATEGORY_ORDER as readonly string[]).includes(cat) && entries.length) {
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      parts.push(`**${label}**\n${entries.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

// ── Layer 3 — Member context ──────────────────────────────────────────────────

function buildMemberLayer(
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

export async function assembleMemoryBlock(
  supabase: SupabaseClient,
  userId: string
): Promise<{ block: string; loadedIds: string[] }> {
  const { data: core } = await supabase
    .from("memory")
    .select("id, content, category, relevance_score, created_at")
    .eq("user_id", userId)
    .eq("tier", "core")
    .order("created_at", { ascending: true })
    .limit(MAX_CORE);

  const { data: active } = await supabase
    .from("memory")
    .select("id, content, category, relevance_score")
    .eq("user_id", userId)
    .eq("tier", "active")
    .order("relevance_score", { ascending: false })
    .limit(MAX_ACTIVE);

  const coreList = (core ?? []) as Array<{
    id: string;
    content: string;
    category: string | null;
    relevance_score: number;
    created_at: string;
  }>;
  const activeList = (active ?? []) as Array<{
    id: string;
    content: string;
    category: string | null;
    relevance_score: number;
  }>;

  const loadedItems: Array<{
    id: string;
    relevance_score: number;
    content: string;
    category: string | null;
  }> = [];
  let wordCount = 0;

  for (const m of coreList) {
    const words = countWords(m.content);
    if (wordCount + words > MAX_WORDS) break;
    loadedItems.push({ id: m.id, relevance_score: m.relevance_score, content: m.content, category: m.category });
    wordCount += words;
  }

  for (const m of activeList) {
    const words = countWords(m.content);
    if (wordCount + words > MAX_WORDS) break;
    loadedItems.push({ id: m.id, relevance_score: m.relevance_score, content: m.content, category: m.category });
    wordCount += words;
  }

  const loadedIds = loadedItems.map((m) => m.id);

  // Fire-and-forget: increment relevance_score (capped at 100) and update last_accessed
  // for every memory actually injected into the prompt.
  if (loadedItems.length > 0) {
    const serviceRole = createServiceRoleClient();
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

  const situational = `## Chat context

This is a private standalone conversation.
Keep responses appropriately concise. Do not pad. Do not summarize back what was just said.`;

  return `${LAYER_IDENTITY}\n\n${LAYER_HOUSEHOLD}\n\n${memberLayer}\n\n${situational}`;
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
    fileContentBlock?: string; // pre-fetched Drive content, injected after file list
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

  if (project.memberNames.length > 1) {
    projectBlock += `\n\n## Group participation rule\n\nYou are a participant in this group project chat, not the default responder. Read every message for context but do not reply unless a message is clearly addressed to you — by name, @ mention, or direct question. Member-to-member conversation is never a trigger. If it is ambiguous whether a message is meant for you or the group, stay silent. Never send the first message. No greeting, no acknowledgment of your presence. When you do respond, be brief and direct.\n\nWrite in plain conversational prose. Never use bullet points, numbered lists, bold, italic, headers, or any markdown formatting. If you feel the urge to use a bullet list, write it as a sentence instead. Responses should be short and direct — two to four sentences maximum unless the question genuinely requires more.`;
  }

  projectBlock += "\n---";

  const situational = `## Chat context

This is a project workspace conversation.

${projectBlock}`;

  return `${LAYER_IDENTITY}\n\n${LAYER_HOUSEHOLD}\n\n${memberLayer}\n\n${situational}`;
}

export function buildFamilyChatSystemPrompt(
  senderName: string,
  memoryBlock: string,
  userTimestamp: string
): string {
  const memberLayer = buildMemberLayer(senderName, userTimestamp, memoryBlock);

  const situational = `## Chat context

This is the Johnson family group chat. Steady and grounded — never chatty, never a cheerleader.

## Participation rule

You are a participant in this group chat, not the default responder. Read every message for context but do not reply unless a message is clearly addressed to you — by name, @ mention, or direct question. Member-to-member conversation is never a trigger. If it is ambiguous whether a message is meant for you or the group, stay silent. Never send the first message. No greeting, no acknowledgment of your presence. When you do respond, be brief and direct.

## Response format

Write in plain conversational prose. Never use bullet points, numbered lists, bold, italic, headers, or any markdown formatting. If you feel the urge to use a bullet list, write it as a sentence instead. Responses should be short and direct — two to four sentences maximum unless the question genuinely requires more.

## Three-tier judgment rule

Before acting on any request, classify the stakes and act accordingly:
- Low stakes (add to a list, log something simple, note a preference): act silently or with a single word at most. No "Done.", no "Got it.", no "Added." Reactions will handle acknowledgment — your text output should be empty or nearly empty.
- Medium stakes (update a document, modify a project, schedule something): flag before acting — say "I can do X — want me to go ahead?"
- High stakes (any write to an external system, deletion, irreversible change): always ask explicitly before acting. No exceptions.

## Tone rules

- No filler phrases. Never say: "got it", "sure thing", "totally", "fingers crossed", "and yes, understood", "hope this works", or any similar casual filler.
- No self-doubt. Never express uncertainty about your own functioning or reliability. Speak with quiet confidence.
- No deflecting to specific people. If you don't know something, say so simply or check the relevant project. Never redirect a question to another household member by name.
- If the action speaks for itself, stop. Never append meta-commentary to a completed action.
- Emotional messages: if someone shares stress, frustration, or hope, respond with one or two sentences — warm, grounded, not performative. Never therapist-mode.

Do not summarize back what was just said.`;

  return `${LAYER_IDENTITY}\n\n${LAYER_HOUSEHOLD}\n\n${memberLayer}\n\n${situational}`;
}

// ── Tool blocks (unchanged) ───────────────────────────────────────────────────

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
