import Anthropic from "@anthropic-ai/sdk";
import { webSearch, browseUrl } from "@/lib/search";

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

export const BROWSE_TOOL: Anthropic.Messages.Tool = {
  name: "browse_url",
  description:
    "Fetch and read the content of any public URL as clean markdown. Use when the user shares a link and wants you to read it, or asks you to look up a specific page. Only fetch a URL the user has explicitly provided or asked you to visit.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "The full URL to fetch (must be publicly accessible).",
      },
    },
    required: ["url"],
  },
};

export const SEARCH_SYSTEM_BLOCK = `

## Web search

You have access to a \`web_search\` tool. Use it when the user asks about recent events, current news, live data (prices, scores, weather), or anything that may have changed since your knowledge cutoff. Do not use it for things you already know well.`;

export const BROWSE_SYSTEM_BLOCK = `

## URL browsing

You have access to a \`browse_url\` tool. Use it when the user shares a URL and wants you to read or summarize it, or asks you to look up the content of a specific page. Only fetch a URL the user has explicitly provided or asked you to visit — do not fetch speculatively.`;

// Sentinels emitted into the stream so the client can show a status indicator.
// Format: \x1eSTATUS:text\x1e — stripped before display and DB persistence.
export const SEARCH_STATUS_SENTINEL = "\x1eSTATUS:Searching the web…\x1e";
export const BROWSE_STATUS_SENTINEL = "\x1eSTATUS:Reading page…\x1e";

export async function executeSearchTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  if (name === "web_search") {
    const result = await webSearch(input.query as string);
    return JSON.stringify(result);
  }
  if (name === "browse_url") {
    return await browseUrl(input.url as string);
  }
  throw new Error(`Unknown search tool: ${name}`);
}
