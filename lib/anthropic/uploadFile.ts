/**
 * Upload a file to the Anthropic Files API and return the file_id.
 * Returns null on any failure — callers fall back to base64.
 */
export async function uploadToAnthropicFiles(
  base64: string,
  mediaType: string,
  filename: string,
): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const buffer = Buffer.from(base64, "base64");
    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: mediaType }), filename);

    const response = await fetch("https://api.anthropic.com/v1/files", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
      },
      body: formData,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[uploadToAnthropicFiles] upload failed:", response.status, body);
      return null;
    }

    const data = (await response.json()) as { id: string };
    return data.id ?? null;
  } catch (err) {
    console.error("[uploadToAnthropicFiles] error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
