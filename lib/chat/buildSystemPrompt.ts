// Single entry point for Bruce's system prompt across every chat context.
// Routes pass a SystemPromptContext and get back an array of system blocks —
// they never assemble prompt fragments themselves.
//
// Shared layers (identity, household, member context, formatting, tool
// discipline) are written once here. Mode-specific branches handle project
// blocks (project chats), participation/group rules (group + family), the
// three-tier confirmation rule (family), and dev workspace situational
// context.
//
// PROMPT CACHING: the return value is two text blocks. Block 1 holds every
// layer that is stable across a chat's messages (identity, household, market
// intelligence, chat context incl. project instructions/files, tool blocks)
// and carries cache_control — Anthropic caches the prefix through this block,
// which also covers the tools array. Block 2 holds the volatile per-message
// layers (member/session layer with timestamp + memory, location, reminders,
// browser context) and is re-read every call. Keep anything that changes
// per-message OUT of block 1 or the cache will never hit.

import type Anthropic from "@anthropic-ai/sdk";
import {
  LAYER_IDENTITY,
  LAYER_HOUSEHOLD,
  buildMemberLayer,
} from "@/lib/anthropic";
import { buildToolSystemBlocks } from "@/lib/chat/streamHandler";

export type SystemPromptBlocks = Anthropic.Messages.TextBlockParam[];

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
  /**
   * Active shared-browser session note. Pre-formatted by the route from
   * getActiveBrowserSession(chatId). Present only when a live session exists so
   * Bruce knows the panel is open and what URL it's showing.
   */
  browserContext?: string;
  /**
   * Automated-run preamble injected by the scheduled-tasks cron dispatcher.
   * Present only on standing-task runs — tells Bruce no member is live in the
   * chat and the task prompt is the entire instruction.
   */
  scheduledTaskContext?: string;
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

## When to react

Use react_to_message instead of text when:
- The message is purely informational — news, an update, a confirmation — and acknowledgment is appropriate but no reply is needed
- A reaction conveys the right response and text would add nothing

Use 👍 to acknowledge, confirm, or agree. Use ❤️ when a message is warm, personal, or emotionally significant — a kind gesture, a family moment, something shared. Do not use ❤️ for task confirmations or neutral exchanges.

## When to stay silent

Say nothing when:
- Members are talking to each other and you are mentioned incidentally
- Someone says they hope you won't respond, don't want you to respond, or that you shouldn't respond — that is a meta-comment, not a request
- The conversation is clearly between members and your input wasn't invited
- A member is venting, celebrating, or sharing something with another member

Lean toward staying silent over reacting — reactions still signal presence and can feel intrusive if overused. One missed response is recoverable. An unwanted intrusion is not.

When in doubt, stay silent.`;

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

export function buildSystemPrompt(ctx: SystemPromptContext): SystemPromptBlocks {
  const memberLayer = buildMemberLayer(ctx.userName, ctx.userTimestamp, ctx.memoryBlock);

  if (ctx.mode === "dev") {
    const stable = [LAYER_IDENTITY, LAYER_HOUSEHOLD, ...(ctx.extraSections ?? [])].join("\n\n");
    return [
      { type: "text", text: stable, cache_control: { type: "ephemeral" } },
      { type: "text", text: memberLayer },
    ];
  }

  const chatContext = buildChatContextBlock(ctx);
  const stable =
    [LAYER_IDENTITY, LAYER_HOUSEHOLD, MARKET_INTELLIGENCE, chatContext].join("\n\n") +
    buildToolSystemBlocks({ includeImageGen: !!ctx.includeImageGen });

  let volatile = memberLayer;
  if (ctx.locationContext) volatile += `\n\n${ctx.locationContext}`;
  if (ctx.remindersContext) volatile += `\n\n${ctx.remindersContext}`;
  if (ctx.browserContext) volatile += `\n\n${ctx.browserContext}`;
  if (ctx.scheduledTaskContext) volatile += `\n\n${ctx.scheduledTaskContext}`;

  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: volatile },
  ];
}
