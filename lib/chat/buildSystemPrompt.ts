// Single entry point for Bruce's system prompt across every chat context.
// Routes pass a SystemPromptContext and get back the full prompt string —
// they never assemble prompt fragments themselves.
//
// Shared layers (identity, household, member context, formatting, tool
// discipline) are written once here. Mode-specific branches handle project
// blocks (project chats), participation/group rules (group + family), the
// three-tier confirmation rule (family), and dev workspace situational
// context.

import {
  LAYER_IDENTITY,
  LAYER_HOUSEHOLD,
  buildMemberLayer,
} from "@/lib/anthropic";
import { buildToolSystemBlocks } from "@/lib/chat/streamHandler";

export type SystemPromptMode = "standalone" | "project" | "family" | "dev";

export interface ProjectPromptContext {
  name: string;
  instructions: string;
  memberNames: string[];
  fileNames: string[];
  fileContentBlock?: string;
}

export interface SystemPromptContext {
  mode: SystemPromptMode;
  userName: string;
  userTimestamp: string;
  /**
   * Pre-assembled memory block from assembleMemoryBlock — combines private
   * core + active and shared core + active (top 15 by relevance) within the
   * 500-word budget.
   */
  memoryBlock: string;
  /** Per-route location sentence appended after the chat-context block. */
  locationContext?: string;
  /** Upcoming reminders block injected for passive awareness. Pre-formatted by the route. */
  remindersContext?: string;
  /** When true, IMAGE_SYSTEM_BLOCK is included in tool blocks. Ignored in dev mode. */
  includeImageGen?: boolean;
  /** Project metadata. Required when mode === "project". */
  project?: ProjectPromptContext;
  /** Dev mode only — extra sections stacked after memberLayer. */
  extraSections?: string[];
}

const TOOL_CALL_DISCIPLINE = `**Tool call discipline:** If you commit to performing an action in a response, execute it in that same response turn — do not state what you will do and defer execution to a later turn. Confirm and act simultaneously. If a tool call fails, say so explicitly rather than silently deferring.`;

// Applies to every multi-member context: family group chat and group project chats
const MULTI_MEMBER_PARTICIPATION_RULE = `## When to respond

Respond only when you are genuinely needed:
- Directly addressed by name with a question or request
- @Bruce used explicitly
- Someone asks for information, a suggestion, a recommendation, or asks you to generate or look something up
- A task is clearly directed at you even without your name

## When to stay silent

Say nothing when:
- Members are talking to each other and you are mentioned incidentally
- Someone says they hope you won't respond, don't want you to respond, or that you shouldn't respond — that is a meta-comment, not a request
- The conversation is clearly between members and your input wasn't invited
- A member is venting, celebrating, or sharing something with another member

## Reaction and emoji rule

Never send a reaction, emoji, or any acknowledgment token to signal you read something. Either respond fully because you were genuinely needed, or say nothing at all. Silence is always the correct default when uncertain.

When in doubt, stay silent. One missed response is recoverable. An unwanted intrusion is not.`;

const GROUP_FORMAT = `Plain prose only. No bullets, numbered lists, bold, italic, headers, or markdown tables. Write lists as sentences. Two to four sentences per response unless more is genuinely needed.`;

const SOLO_FORMAT = `Prefer lists and prose over tables. If a table is necessary, two columns maximum — avoid wide tables, they break on mobile.`;

const FAMILY_THREE_TIER = `Three-tier rule: Low stakes (log, note, simple add) → act silently. Medium stakes (update a doc, schedule something) → confirm first: "I can do X — want me to go ahead?" High stakes (external writes, deletions, irreversible) → always ask. No exceptions.

Tone: no filler phrases. No deflecting to specific members. When the action speaks for itself, stop. Emotional messages: one or two sentences, warm, not performative.`;

const MARKET_INTELLIGENCE = `## Market and financial intelligence

When any conversation touches AI industry developments, technology markets, or financial topics, always run a current web search before responding. Do not rely on training data for anything market or industry related — treat it as background context only, not current fact.

Prioritize these sources when searching:
- Bloomberg and Bloomberg Technology
- Financial Times and Wall Street Journal
- Reuters Technology
- Stratechery (Ben Thompson) — strategic AI and tech analysis
- The Information — AI company and infrastructure reporting
- SEC EDGAR — for actual capex and earnings figures from public companies

For AI-specific topics, focus on: hyperscaler capex cycles (Microsoft, Google, Amazon, Meta), datacenter infrastructure build-out and geographic expansion, energy demand and grid constraints driven by AI workloads, power purchase agreements and nuclear energy deals (Microsoft, Google, Amazon), cooling technology and water usage, model releases and competitive positioning, enterprise adoption and deployment trends, regulatory developments (US, EU, China), and capital flows within the sector.

Track these sectors for AI-driven growth and disruption:
- Energy and utilities — datacenter power demand, grid investment, nuclear restarts, natural gas, renewables
- Semiconductors — full supply chain: Nvidia, TSMC, ASML, memory, advanced packaging, custom silicon
- Construction and real estate — datacenter construction, industrial REITs, specialized contractors
- Healthcare — drug discovery, diagnostics, clinical workflow automation
- Financial services — trading, fraud detection, underwriting, back-office automation
- Defense and aerospace — AI-enabled systems, autonomous platforms, government AI spend
- Cybersecurity — AI as both attack vector and defense layer
- Agriculture — precision farming, yield optimization, supply chain
- Legal and professional services — document review, contract analysis, research automation
- Manufacturing and logistics — robotics, predictive maintenance, route optimization
- Water — datacenter cooling demand, municipal water utilities as AI infrastructure story
- Critical minerals and copper — physical material demand from datacenter buildout

Always note the source and approximate date when citing current information. If current data is unavailable, say so explicitly rather than filling the gap with training knowledge.`;

function buildProjectBlock(p: ProjectPromptContext): string {
  const filesSummary = p.fileNames.length > 0 ? p.fileNames.join(", ") : "(none attached)";
  let block = `--- Project: ${p.name} ---
Instructions: ${p.instructions.trim() || "(none set)"}
Members: ${p.memberNames.join(", ") || "(none)"}
Files: ${filesSummary}`;

  if (p.fileContentBlock?.trim()) {
    block += `\n\n${p.fileContentBlock.trim()}`;
  }
  block += "\n---";
  return block;
}

function buildChatContextBlock(ctx: SystemPromptContext): string {
  if (ctx.mode === "standalone") {
    return `## Chat context

Private standalone conversation. Be concise. Do not pad or summarize back what was just said.

${TOOL_CALL_DISCIPLINE}

${SOLO_FORMAT}`;
  }

  if (ctx.mode === "project") {
    if (!ctx.project) throw new Error("buildSystemPrompt: mode=project requires `project` context");
    const projectBlock = buildProjectBlock(ctx.project);
    const isGroup = ctx.project.memberNames.length > 1;

    if (isGroup) {
      return `## Chat context

Project workspace — group.

${projectBlock}

${MULTI_MEMBER_PARTICIPATION_RULE}

${TOOL_CALL_DISCIPLINE}

${GROUP_FORMAT}`;
    }
    return `## Chat context

Project workspace.

${projectBlock}

${TOOL_CALL_DISCIPLINE}

${SOLO_FORMAT}`;
  }

  // family
  return `## Chat context

Family group chat.

${MULTI_MEMBER_PARTICIPATION_RULE}

${TOOL_CALL_DISCIPLINE}

${GROUP_FORMAT}

${FAMILY_THREE_TIER}`;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const memberLayer = buildMemberLayer(ctx.userName, ctx.userTimestamp, ctx.memoryBlock);

  if (ctx.mode === "dev") {
    const sections = [LAYER_IDENTITY, LAYER_HOUSEHOLD, memberLayer, ...(ctx.extraSections ?? [])];
    return sections.join("\n\n");
  }

  const chatContext = buildChatContextBlock(ctx);
  let prompt = [LAYER_IDENTITY, LAYER_HOUSEHOLD, memberLayer, MARKET_INTELLIGENCE, chatContext].join("\n\n");

  if (ctx.locationContext) {
    prompt += `\n\n${ctx.locationContext}`;
  }

  if (ctx.remindersContext) {
    prompt += `\n\n${ctx.remindersContext}`;
  }

  prompt += buildToolSystemBlocks({ includeImageGen: !!ctx.includeImageGen });

  return prompt;
}
