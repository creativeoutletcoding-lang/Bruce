// browse_page tool — opens the shared inline browser panel and drives it.
// Definition + system block live here; execution is handled specially inside
// runChatStream (it needs the stream controller to emit the browser_event so
// the panel opens the moment Bruce starts working).

export const BROWSE_PAGE_TOOL = {
  name: "browse_page",
  description:
    "Open a browser panel that the user can see and interact with in real time. Navigate to URLs, interact with page elements, or extract content from any website. The browser is shared — the user sees everything you do and can take control at any time. Use navigate first, then act or extract. Always describe what you're doing as you go.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["navigate", "act", "extract", "screenshot"],
        description:
          "navigate: go to a URL. act: click/type/interact using natural language description. extract: pull structured content from the current page. screenshot: capture the current page state.",
      },
      url: {
        type: "string",
        description: "Full URL including https:// — required for navigate action.",
      },
      instruction: {
        type: "string",
        description:
          "Natural language description of what to do or extract — required for act and extract actions.",
      },
    },
    required: ["action"],
  },
};

export const BROWSER_SYSTEM_BLOCK = `

## browse_page — shared live browser

You have a browse_page tool. When you use it, a shared browser panel opens that the user can see and interact with in real time — you both control the same browser session. Navigate first (action: "navigate" with a full https:// URL), then "act" (natural-language click/type) or "extract" (pull content from the current page). "screenshot" captures the current view.

Narrate as you go — say what you're about to do before each step. The user can click and type in the panel themselves at any time; your next action sees whatever state the page is now in, so don't assume the page hasn't changed. Use this for tasks the user benefits from watching (filling a form together, browsing a site, checking live availability) — prefer web_search for quick factual lookups and browse_url for reading a single page the user handed you.`;
