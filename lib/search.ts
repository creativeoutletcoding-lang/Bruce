// URL fetching via Jina Reader. Web search is handled by Anthropic's native
// web_search server tool (see lib/searchTools.ts) — there is no third-party
// search provider in this codebase.

export async function browseUrl(url: string): Promise<string> {
  if (!process.env.JINA_API_KEY) {
    throw new Error("JINA_API_KEY is not configured");
  }
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      Accept: "text/markdown",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  if (!text.trim()) {
    throw new Error("URL returned empty content");
  }
  return text;
}
