import { createServiceRoleClient } from "@/lib/supabase/server";
import { uploadImageToPersonalFolder } from "@/lib/google/drive";

const REPLICATE_API = "https://api.replicate.com/v1";
export const IMAGE_MODEL = "black-forest-labs/flux-schnell";

export interface ImageGenerationResult {
  messageId: string;
  url: string;
  prompt: string;
  model: string;
}

export async function generateImageAndSave(
  prompt: string,
  userId: string,
  chatId: string
): Promise<ImageGenerationResult> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  // 1. Create Replicate prediction
  const createRes = await fetch(
    `${REPLICATE_API}/models/${IMAGE_MODEL}/predictions`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: { prompt, go_fast: true, num_outputs: 1 },
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate create failed: ${createRes.status} — ${err}`);
  }

  const prediction = (await createRes.json()) as {
    id: string;
    status: string;
    output?: string[];
  };

  // 2. Poll until complete (max 60s)
  let imageUrl: string | null = null;
  for (let i = 0; i < 60; i++) {
    if (prediction.status === "succeeded" && prediction.output?.length) {
      imageUrl = prediction.output[0];
      break;
    }
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error("Image generation failed on Replicate");
    }
    await new Promise((r) => setTimeout(r, 1000));

    const pollRes = await fetch(
      `${REPLICATE_API}/predictions/${prediction.id}`,
      { headers: { Authorization: `Token ${token}` } }
    );
    const updated = (await pollRes.json()) as {
      status: string;
      output?: string[];
    };
    prediction.status = updated.status;
    prediction.output = updated.output;
  }

  if (!imageUrl) throw new Error("Image generation timed out");

  // 3. Download image from Replicate
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("Failed to download generated image");
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get("content-type") ?? "image/webp";
  const ext = contentType.includes("jpeg")
    ? "jpg"
    : contentType.includes("png")
    ? "png"
    : "webp";
  const filename = `bruce-image-${Date.now()}.${ext}`;

  // 4. Upload to Drive (fallback to Replicate URL if Drive unavailable)
  let displayUrl = imageUrl;
  try {
    displayUrl = await uploadImageToPersonalFolder(
      userId,
      imgBuffer,
      contentType,
      filename
    );
  } catch {
    // Drive unavailable — use temporary Replicate URL
  }

  // 5. Save image message to DB
  const adminSupabase = createServiceRoleClient();
  const { data: msg, error } = await adminSupabase
    .from("messages")
    .insert({
      chat_id: chatId,
      sender_id: null,
      role: "assistant",
      content: `[Image: ${prompt.substring(0, 100)}]`,
      metadata: {
        content_type: "image",
        image_url: displayUrl,
        prompt,
        model: IMAGE_MODEL,
      },
    })
    .select("id")
    .single();

  if (error || !msg) throw new Error("Failed to save image message to DB");

  return {
    messageId: msg.id as string,
    url: displayUrl,
    prompt,
    model: IMAGE_MODEL,
  };
}
