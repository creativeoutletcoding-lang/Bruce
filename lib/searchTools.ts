import Anthropic from "@anthropic-ai/sdk";
import { webSearch, browseUrl } from "@/lib/search";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

export const HISTORY_SEARCH_TOOL: Anthropic.Messages.Tool = {
  name: "search_chat_history",
  description:
    "Search conversation history for relevant context. Use when the user references something from a prior discussion, asks what was decided before, or when relevant context likely exists in other conversations. Do not search the current conversation — only prior history. Do not announce that you are searching — search and incorporate results naturally.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Keywords or short phrase describing what to find.",
      },
      scope: {
        type: "string",
        enum: ["project", "private", "family"],
        description:
          "Which history to search: 'project' for the current project's chats, 'private' for standalone private chats, 'family' for family group chats.",
      },
      limit: {
        type: "number",
        description: "Maximum message chunks to return. Default 8.",
      },
    },
    required: ["query", "scope"],
  },
};

export const HISTORY_SEARCH_SYSTEM_BLOCK = `

## Chat history search

You have access to a \`search_chat_history\` tool. Use it when the user references something from a prior conversation, asks what was decided or discussed before, or when relevant context likely exists in earlier chats. Use scope='project' in project chats, scope='private' in standalone chats, scope='family' in family chat. Search before telling the user you don't have access to prior conversations. Do not announce that you are searching.`;

export const HISTORY_SEARCH_STATUS_SENTINEL = "\x1eSTATUS:Searching history…\x1e";

interface ChatRow { id: string; title: string | null }
interface MessageRow { content: string; role: string; created_at: string; chat_id: string }
interface ChatMemberRow { chat_id: string }

export async function executeHistorySearchTool(
  input: Record<string, unknown>,
  userId: string,
  currentChatId: string | null,
  projectId: string | null,
): Promise<string> {
  const query = (input.query as string) ?? "";
  const scope = (input.scope as string) ?? "private";
  const limit = typeof input.limit === "number" ? Math.min(input.limit, 20) : 8;

  if (!query.trim()) {
    return JSON.stringify({ results: [], message: "No matching content found." });
  }

  const supabase = createServiceRoleClient();
  let chatIds: string[] = [];

  if (scope === "project") {
    if (!projectId) return JSON.stringify({ results: [], message: "No project context available." });
    let q = supabase.from("chats").select("id").eq("project_id", projectId);
    if (currentChatId) q = q.neq("id", currentChatId);
    const { data } = await q;
    chatIds = (data as ChatRow[] | null ?? []).map((c) => c.id);
  } else if (scope === "private") {
    let q = supabase
      .from("chats")
      .select("id")
      .eq("owner_id", userId)
      .eq("type", "private")
      .is("project_id", null);
    if (currentChatId) q = q.neq("id", currentChatId);
    const { data } = await q;
    chatIds = (data as ChatRow[] | null ?? []).map((c) => c.id);
  } else {
    // family
    const { data: memberRows } = await supabase
      .from("chat_members")
      .select("chat_id")
      .eq("user_id", userId);
    const memberChatIds = (memberRows as ChatMemberRow[] | null ?? []).map((r) => r.chat_id);
    if (memberChatIds.length === 0) return JSON.stringify({ results: [], message: "No matching content found." });
    let q = supabase.from("chats").select("id").in("id", memberChatIds).eq("type", "family");
    if (currentChatId) q = q.neq("id", currentChatId);
    const { data } = await q;
    chatIds = (data as ChatRow[] | null ?? []).map((c) => c.id);
  }

  if (chatIds.length === 0) {
    return JSON.stringify({ results: [], message: "No matching content found." });
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("content, role, created_at, chat_id")
    .in("chat_id", chatIds)
    .in("role", ["user", "assistant"])
    .textSearch("content", query, { type: "plain", config: "english" })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!messages || (messages as MessageRow[]).length === 0) {
    return JSON.stringify({ results: [], message: "No matching content found." });
  }

  const matchedChatIds = [...new Set((messages as MessageRow[]).map((m) => m.chat_id))];
  const { data: chats } = await supabase.from("chats").select("id, title").in("id", matchedChatIds);
  const chatTitleMap = Object.fromEntries(
    (chats as ChatRow[] | null ?? []).map((c) => [c.id, c.title ?? "Untitled"])
  );

  const results = (messages as MessageRow[]).map((m) => ({
    chat_title: chatTitleMap[m.chat_id] ?? "Untitled",
    date: new Date(m.created_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    role: m.role as "user" | "assistant",
    excerpt: (m.content ?? "").slice(0, 400),
  }));

  return JSON.stringify({ results });
}

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
