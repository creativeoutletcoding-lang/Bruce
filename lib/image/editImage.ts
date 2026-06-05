import { fal } from "@fal-ai/client";

// Image-editing module. Wraps fal.ai FLUX.1 Kontext [pro] and returns a hosted
// URL. Accepts any public image URL — Kontext fetches it server-side, no base64
// needed. The fal client reads FAL_KEY from the environment automatically.

export interface EditImageResult {
  url: string;
}

export async function editImage(imageUrl: string, prompt: string): Promise<EditImageResult> {
  if (!process.env.FAL_KEY) {
    throw new Error("Image editing is not configured");
  }

  const endpoint: string = "fal-ai/flux-pro/kontext";

  try {
    const result = await fal.subscribe(endpoint, {
      input: {
        image_url: imageUrl,
        prompt,
      },
    });
    const data = result.data as { images?: Array<{ url?: string }> };
    const url = data.images?.[0]?.url;
    if (!url) throw new Error("fal.ai returned no image");
    return { url };
  } catch (err) {
    console.error("[editImage] fal.ai failed:", err instanceof Error ? err.message : String(err));
    throw new Error("Image editing failed — please try again.");
  }
}
