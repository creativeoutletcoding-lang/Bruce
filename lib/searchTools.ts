import Anthropic from "@anthropic-ai/sdk";
import { webSearch } from "@/lib/search";

export const SEARCH_TOOL: Anthropic.Messages.Tool = {
  name: "web_search",
  description:
    "Search the web for current information. Use when the user asks about recent events, real-time data, live prices, sports scores, news, weather, or anything that may have changed since your knowledge cutoff. Do not use for things you already know well.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query to run. Be specific and concise.",
      },
    },
    required: ["query"],
  },
};

export const SEARCH_SYSTEM_BLOCK = `

## Web search

You have access to a \`web_search\` tool. Use it when the user asks about recent events, current news, live data (prices, scores, weather), or anything that may have changed since your knowledge cutoff. Do not use it for things you already know well.`;

// Sentinel emitted into the stream so the client can show a status indicator.
// Format: \x1eSTATUS:text\x1e — stripped before display and DB persistence.
export const SEARCH_STATUS_SENTINEL = "\x1eSTATUS:Searching the web…\x1e";

export async function executeSearchTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  if (name === "web_search") {
    const result = await webSearch(input.query as string);
    return JSON.stringify(result);
  }
  throw new Error(`Unknown search tool: ${name}`);
}
