import { fal } from "@fal-ai/client";

// Single image-generation module. Wraps fal.ai FLUX.1 and returns a hosted URL.
// fal.ai runs the model server-side with no cold start, so there is no polling
// loop — one request returns the image. The fal client reads FAL_KEY from the
// environment automatically.

export type FalImageModel = "fal-ai/flux/dev" | "fal-ai/flux-pro/v1.1";

export type FalImageSize =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9";

export interface GenerateImageOptions {
  prompt: string;
  /** fal model id. Defaults to FLUX.1 [dev]; pass flux-pro/v1.1 for higher quality. */
  model?: FalImageModel;
  /** Aspect/size preset. fal defaults to landscape_4_3 when omitted. */
  imageSize?: FalImageSize;
}

export interface GenerateImageResult {
  url: string;
}

export async function generateImage({
  prompt,
  model = "fal-ai/flux/dev",
  imageSize,
}: GenerateImageOptions): Promise<GenerateImageResult> {
  if (!process.env.FAL_KEY) {
    throw new Error("Image generation is not configured");
  }

  // Pass the endpoint as a plain string so fal's per-endpoint generics fall back
  // to permissive input/output types — avoids a union-input mismatch across models.
  const endpoint: string = model;

  try {
    const result = await fal.subscribe(endpoint, {
      input: {
        prompt,
        num_images: 1,
        ...(imageSize ? { image_size: imageSize } : {}),
      },
    });
    const data = result.data as { images?: Array<{ url?: string }> };
    const url = data.images?.[0]?.url;
    if (!url) throw new Error("fal.ai returned no image");
    return { url };
  } catch (err) {
    console.error("[generateImage] fal.ai failed:", err instanceof Error ? err.message : String(err));
    // User-facing fallback message — callers surface this to the chat.
    throw new Error("Image generation failed — please try again.");
  }
}
