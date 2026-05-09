export interface SearchResult {
  query: string;
  answer: string;
  sources: { title: string; url: string }[];
}

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

export async function webSearch(query: string): Promise<SearchResult> {
  console.log('webSearch called, key present:', !!process.env.PERPLEXITY_API_KEY, 'key length:', process.env.PERPLEXITY_API_KEY?.length ?? 0);
  if (!process.env.PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY is not configured");
  }
  console.log("Perplexity search triggered:", query);
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [{ role: "user", content: query }],
      return_citations: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Perplexity search failed: ${response.statusText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    citations?: string[];
  };
  const answer = data.choices[0].message.content;
  const sources = (data.citations ?? []).map((url, i) => ({
    title: `Source ${i + 1}`,
    url,
  }));

  return { query, answer, sources };
}
