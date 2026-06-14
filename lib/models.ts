// Single source of truth for the Claude models Bruce exposes, plus effort-level
// metadata. Per-model effort support and levels are taken from the Anthropic
// docs (https://platform.claude.com/docs/en/build-with-claude/effort):
//   - Opus 4.8 / Opus 4.7: effort low|medium|high|xhigh|max, default high
//   - Sonnet 4.6:          effort low|medium|high|max (NO xhigh), default high
//                          (docs recommend medium for chat/latency-sensitive use)
//   - Haiku 4.5:           effort NOT supported
// Effort is sent as `output_config: { effort }` on the messages request; no
// thinking param is needed (these models use adaptive thinking, and manual
// `thinking:{type:"enabled"}` is rejected on Opus 4.8/4.7). `thinkingAlwaysOn`
// is reserved for future Fable-class models and is false for the whole lineup.

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelConfig {
  id: string;
  displayName: string;
  description: string;
  isDefault?: boolean;
  supportsEffort: boolean;
  effortLevels: EffortLevel[];
  defaultEffort: EffortLevel | null;
  /** Future Fable-class models reason on every turn; false for the current lineup. */
  thinkingAlwaysOn: boolean;
}

/** Haiku id, shared by the picker entry and the side-task constant (dedupe). */
export const HAIKU_MODEL_ID = "claude-haiku-4-5-20251001";

export const MODELS: ModelConfig[] = [
  {
    id: "claude-opus-4-8",
    displayName: "Opus 4.8",
    description: "Most capable. Best for the hardest problems, deep reasoning, and long-running work.",
    supportsEffort: true,
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    thinkingAlwaysOn: false,
  },
  {
    id: "claude-opus-4-7",
    displayName: "Opus 4.7",
    description: "Highly capable. Strong reasoning and agentic work.",
    supportsEffort: true,
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "high",
    thinkingAlwaysOn: false,
  },
  {
    id: "claude-sonnet-4-6",
    displayName: "Sonnet 4.6",
    description: "Balanced. Smart and fast. Bruce's default.",
    isDefault: true,
    supportsEffort: true,
    effortLevels: ["low", "medium", "high", "max"],
    defaultEffort: "medium",
    thinkingAlwaysOn: false,
  },
  {
    id: HAIKU_MODEL_ID,
    displayName: "Haiku 4.5",
    description: "Fast and efficient. Best for quick questions and everyday tasks.",
    supportsEffort: false,
    effortLevels: [],
    defaultEffort: null,
    thinkingAlwaysOn: false,
  },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Fixed model for internal/system tasks (titles run on HAIKU_MODEL; this is for
 *  the family engagement turn, the Bruce Dev workspace, and the instructions
 *  summarizer — pinned, not user-selectable). */
export const SYSTEM_TASK_MODEL = "claude-sonnet-4-6";

export function getModel(id: string | null | undefined): ModelConfig | undefined {
  return MODELS.find((m) => m.id === id);
}

export function isValidModelId(id: string | null | undefined): boolean {
  return MODELS.some((m) => m.id === id);
}

/** Clamp any id (null, stale, or removed) to a valid ModelConfig — never throws. */
export function resolveModel(id: string | null | undefined): ModelConfig {
  return getModel(id) ?? getModel(DEFAULT_MODEL)!;
}

export function modelLabel(id: string): string {
  return getModel(id)?.displayName ?? "Sonnet";
}

export function isValidEffort(value: string | null | undefined): value is EffortLevel {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

export function defaultEffortForModel(id: string): EffortLevel | null {
  return getModel(id)?.defaultEffort ?? null;
}

/**
 * Resolve the effort to send for a model: returns the requested level when the
 * model supports it, otherwise the model's default; null when the model takes no
 * effort param (so callers omit `output_config` entirely). Never sends an
 * unsupported level (e.g. xhigh to Sonnet) which would 400.
 */
export function validEffortForModel(
  id: string,
  effort: string | null | undefined
): EffortLevel | null {
  const m = getModel(id);
  if (!m || !m.supportsEffort) return null;
  if (effort && m.effortLevels.includes(effort as EffortLevel)) return effort as EffortLevel;
  return m.defaultEffort;
}
