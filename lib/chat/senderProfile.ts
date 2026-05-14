// Shared helpers for resolving sender display names and colors across chat
// contexts. Use these instead of ad hoc `.split(" ")[0]` or color fallbacks.

const FALLBACK_PALETTE = [
  "#0F6E56", "#7A4FD4", "#C2410C", "#3F6212", "#1D4ED8",
  "#B91C1C", "#0E7490", "#7C2D12", "#4338CA", "#9D174D",
] as const;

export function getDisplayName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  const idx = trimmed.indexOf(" ");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getProfileColor(
  userId: string | null | undefined,
  colorHex: string | null | undefined
): string {
  if (colorHex && colorHex.trim()) return colorHex;
  if (!userId) return FALLBACK_PALETTE[0];
  return FALLBACK_PALETTE[hashString(userId) % FALLBACK_PALETTE.length];
}
