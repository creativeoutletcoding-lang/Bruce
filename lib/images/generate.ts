import { createServiceRoleClient } from "@/lib/supabase/server";
import { uploadImageToPersonalFolder } from "@/lib/google/drive";

const REPLICATE_API = "https://api.replicate.com/v1";
const MODEL_STANDARD = "black-forest-labs/flux-schnell";
const MODEL_HD = "black-forest-labs/flux-dev";

export type ImageQuality = "standard" | "hd";

export interface ImageGenerationResult {
  messageId: string;
  url: string;
  prompt: string;
  model: string;
  quality: ImageQuality;
}

export async function generateImageAndSave(
  prompt: string,
  userId: string,
  chatId: string,
  quality: ImageQuality = "standard"
): Promise<ImageGenerationResult> {
  console.log("[generate] function entered, token present:", !!process.env.REPLICATE_API_TOKEN);

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not configured");

  const model = quality === "hd" ? MODEL_HD : MODEL_STANDARD;
  const input =
    quality === "hd"
      ? { prompt, num_outputs: 1 }
      : { prompt, go_fast: true, num_outputs: 1 };

  console.log(`[generate] creating Replicate prediction — model=${model}`);

  // 1. Create Replicate prediction
  let createRes: Response;
  try {
    createRes = await fetch(
      `${REPLICATE_API}/models/${model}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      }
    );
  } catch (fetchErr) {
    console.error("[generate] Replicate fetch threw:", fetchErr instanceof Error ? fetchErr.message : String(fetchErr));
    throw fetchErr;
  }

  if (!createRes.ok) {
    const errBody = await createRes.text().catch(() => "(unreadable)");
    console.error(`[generate] Replicate create failed: status=${createRes.status} body=${errBody}`);
    throw new Error(`Replicate create failed: ${createRes.status} — ${errBody}`);
  }

  console.log("[generate] Replicate prediction created successfully");
  console.log(`[generate] NODE_ENV=${process.env.NODE_ENV}`);

  const prediction = (await createRes.json()) as {
    id: string;
    status: string;
    output?: string[];
    error?: unknown;
  };

  // 2. Poll until complete (max 60s)
  let imageUrl: string | null = null;
  const MAX_ATTEMPTS = 60;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    console.log(`[generate] polling attempt ${i + 1} — status: ${prediction.status}`);
    if (prediction.status === "succeeded" && prediction.output?.length) {
      imageUrl = prediction.output[0];
      console.log(`[generate] prediction succeeded — output URL: ${imageUrl}`);
      break;
    }
    if (prediction.status === "failed" || prediction.status === "canceled") {
      console.error(`[generate] Replicate prediction failed — error: ${JSON.stringify(prediction.error ?? null)}`);
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
      error?: unknown;
    };
    prediction.status = updated.status;
    prediction.output = updated.output;
    prediction.error = updated.error;
  }

  if (!imageUrl) {
    console.error(`[generate] polling timed out after ${MAX_ATTEMPTS} attempts — last status: ${prediction.status}`);
    throw new Error("Image generation timed out");
  }

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
        model,
        quality,
      },
    })
    .select("id")
    .single();

  if (error || !msg) throw new Error("Failed to save image message to DB");

  return {
    messageId: msg.id as string,
    url: displayUrl,
    prompt,
    model,
    quality,
  };
}
