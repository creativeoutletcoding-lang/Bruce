export interface SearchResult {
  query: string;
  answer: string;
  sources: { title: string; url: string }[];
}

export async function webSearch(query: string): Promise<SearchResult> {
  console.log("PERPLEXITY_API_KEY present:", !!process.env.PERPLEXITY_API_KEY);
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
