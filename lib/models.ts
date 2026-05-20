export interface ModelOption {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
}

export const MODELS: ModelOption[] = [
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    description: "Fast and efficient. Best for quick questions and everyday tasks.",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    description: "Balanced. Smart and fast. Bruce's default.",
    isDefault: true,
  },
  {
    id: "claude-opus-4-6",
    label: "Opus 4.6",
    description: "Highly capable. Best for complex reasoning and long tasks.",
  },
  {
    id: "claude-opus-4-7",
    label: "Opus 4.7",
    description: "Most capable model available. Best for the hardest tasks, long-running work, and deep analysis.",
  },
];

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export function modelLabel(id: string): string {
  return MODELS.find((m) => m.id === id)?.label ?? "Sonnet";
}
