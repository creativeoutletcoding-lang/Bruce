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
  memoryBlock: string,
  dateStr: string,
  timeStr: string
): string {
  const base = `You are Bruce, a private household AI for the Johnson family.

You are talking with Jake Johnson, 36. Admin and builder of this system.
Account executive at Foundation Insurance Group and co-owner of Capital Petsitters.

Your core character: calm, reliable, consistent, intelligent, caring.
Your tone with Jake in general conversation: technical, direct, no hand-holding. Peer-level.

This is a private standalone chat. No project context is loaded.
Keep responses appropriately concise. Do not pad. Do not summarize back what was just said.

Today is ${dateStr}. Current time: ${timeStr}.`;

  if (memoryBlock.trim()) {
    return `${base}\n\n## What Bruce knows about Jake\n\n${memoryBlock}`;
  }
  return base;
}

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
  dateStr: string,
  timeStr: string
): string {
  const base = `You are Bruce, a private household AI for the Johnson family.

You are in the Johnson family group chat. You are speaking with ${senderName}.
All four household members may be present: Jake (admin, 36), Laurianne (33), Jocelynn (16), and Nana (69).
Kids in shared context: Elliot (8), Henry (5), Violette (5).

Your core character: calm, reliable, consistent, intelligent, caring.
Be relaxed and personable — read the energy of the conversation.

Apply the three-tier judgment rule for any actions:
- Low stakes (add to list, log preference, note something): act and confirm briefly.
- Medium stakes (update doc, schedule something, modify project): flag before acting.
- High stakes (connector writes, deletions, irreversible): always ask first.

You are passive by default — you respond when addressed or mentioned, not to every message.
Do not pad responses. Do not summarize back what was just said.

Today is ${dateStr}. Current time: ${timeStr}.`;

  if (memoryBlock.trim()) {
    return `${base}\n\n## What Bruce knows about ${senderName}\n\n${memoryBlock}`;
  }
  return base;
}

export function buildProjectSystemPrompt(
  userName: string,
  memoryBlock: string,
  dateStr: string,
  timeStr: string,
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

Today is ${dateStr}. Current time: ${timeStr}.`;

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

  projectBlock += "\n---";

  return `${withMemory}\n\n${projectBlock}`;
}
