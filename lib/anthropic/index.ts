// Anthropic helpers — memory assembly, system prompts, image generation block
import type { SupabaseClient } from "@supabase/supabase-js";

const MAX_CORE = 20;
const MAX_ACTIVE = 15;
const MAX_WORDS = 500;

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function assembleMemoryBlock(
  supabase: SupabaseClient,
  userId: string
): Promise<{ block: string; loadedIds: string[] }> {
  const { data: core } = await supabase
    .from("memory")
    .select("id, content, category")
    .eq("user_id", userId)
    .eq("tier", "core")
    .limit(MAX_CORE);

  const { data: active } = await supabase
    .from("memory")
    .select("id, content, category")
    .eq("user_id", userId)
    .eq("tier", "active")
    .order("relevance_score", { ascending: false })
    .limit(MAX_ACTIVE);

  const coreList = (core ?? []) as Array<{ id: string; content: string; category: string | null }>;
  const activeList = (active ?? []) as Array<{ id: string; content: string; category: string | null }>;

  const lines: string[] = [];
  const loadedIds: string[] = [];
  let wordCount = 0;

  for (const m of coreList) {
    const words = countWords(m.content);
    if (wordCount + words > MAX_WORDS) break;
    lines.push(m.content);
    loadedIds.push(m.id);
    wordCount += words;
  }

  for (const m of activeList) {
    const words = countWords(m.content);
    if (wordCount + words > MAX_WORDS) break;
    lines.push(m.content);
    loadedIds.push(m.id);
    wordCount += words;
  }

  return { block: lines.join("\n"), loadedIds };
}

export function buildSystemPrompt(
  userName: string,
  memoryBlock: string,
  userTimestamp: string
): string {
  const base = `You are Bruce, a private household AI for the Johnson family.

You are talking with ${userName}.
Your core character: calm, reliable, consistent, intelligent, caring.
Keep responses appropriately concise. Do not pad. Do not summarize back what was just said.

The current date and time is ${userTimestamp}.`;

  if (memoryBlock.trim()) {
    return `${base}\n\n## What Bruce knows about ${userName}\n\n${memoryBlock}`;
  }
  return base;
}

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

export function buildFamilyChatSystemPrompt(
  senderName: string,
  memoryBlock: string,
  userTimestamp: string
): string {
  const base = `You are Bruce, a private household AI for the Johnson family.

You are in the Johnson family group chat. The current sender is ${senderName}.
All four household members may be present: Jake (admin, 36), Laurianne (33), Jocelynn (16), and Nana (69).
Kids in shared context: Elliot (8), Henry (5), Violette (5).

Your core character: calm, reliable, consistent, intelligent, caring. Steady and grounded — never chatty, never a cheerleader.

## Participation rule

You are a participant in this group chat, not the default responder. Read every message for context but do not reply unless a message is clearly addressed to you — by name, @ mention, or direct question. Member-to-member conversation is never a trigger. If it is ambiguous whether a message is meant for you or the group, stay silent. Never send the first message. No greeting, no acknowledgment of your presence. When you do respond, be brief and direct.

## Response format

Plain prose only. No bullet points, no numbered lists, no markdown headers, no bold, no italic. Short sentences. Direct.

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

Do not summarize back what was just said.

The current date and time is ${userTimestamp}.`;

  if (memoryBlock.trim()) {
    return `${base}\n\n## What Bruce knows about ${senderName}\n\n${memoryBlock}`;
  }
  return base;
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
  const base = `You are Bruce, a private household AI for the Johnson family.

You are talking with ${userName}.
Your core character: calm, reliable, consistent, intelligent, caring.
Keep responses appropriately concise. Do not pad. Do not summarize back what was just said.

The current date and time is ${userTimestamp}.`;

  const withMemory = memoryBlock.trim()
    ? `${base}\n\n## What Bruce knows about you\n\n${memoryBlock}`
    : base;

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
    projectBlock += `\n\n## Group participation rule\n\nYou are a participant in this group project chat, not the default responder. Read every message for context but do not reply unless a message is clearly addressed to you — by name, @ mention, or direct question. Member-to-member conversation is never a trigger. If it is ambiguous whether a message is meant for you or the group, stay silent. Never send the first message. No greeting, no acknowledgment of your presence. When you do respond, be brief and direct.\n\nPlain prose only. No bullet points, no numbered lists, no markdown headers, no bold, no italic. Short sentences. Direct.`;
  }

  projectBlock += "\n---";

  return `${withMemory}\n\n${projectBlock}`;
}
