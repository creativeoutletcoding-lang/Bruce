import { createServiceRoleClient } from "@/lib/supabase/server";
import { uploadImageToPersonalFolder } from "@/lib/google/drive";
import { generateImage, type FalImageModel } from "@/lib/image/generateImage";
import { editImage } from "@/lib/image/editImage";

export type ImageQuality = "standard" | "hd";

const MODEL_STANDARD: FalImageModel = "fal-ai/flux/dev";
const MODEL_HD: FalImageModel = "fal-ai/flux-pro/v1.1";

export interface ImageGenerationResult {
  messageId: string;
  url: string;
  prompt: string;
  model: string;
  quality: ImageQuality;
}

// Generates an image via fal.ai (lib/image/generateImage), persists it to the
// member's Drive folder (falling back to the fal-hosted URL), and writes the
// image message row. The fal call has no cold start or polling — one request.
export async function generateImageAndSave(
  prompt: string,
  userId: string,
  chatId: string,
  quality: ImageQuality = "standard"
): Promise<ImageGenerationResult> {
  const model = quality === "hd" ? MODEL_HD : MODEL_STANDARD;

  // 1. Generate via fal.ai
  const { url: imageUrl } = await generateImage({ prompt, model });

  // 2. Download the generated image
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("Failed to download generated image");
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
    ? "webp"
    : "jpg";
  const filename = `bruce-image-${Date.now()}.${ext}`;

  // 3. Upload to Drive (fallback to the fal-hosted URL if Drive is unavailable)
  let displayUrl = imageUrl;
  try {
    displayUrl = await uploadImageToPersonalFolder(
      userId,
      imgBuffer,
      contentType,
      filename
    );
  } catch {
    // Drive unavailable — use the temporary fal URL
  }

  // 4. Save the image message to the DB
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

// Calls fal.ai Kontext to edit an existing image, downloads the result,
// uploads to Drive (best-effort), and writes the image message row.
export async function editImageAndSave(
  sourceUrl: string,
  prompt: string,
  userId: string,
  chatId: string
): Promise<{ url: string; messageId: string }> {
  // 1. Edit via fal.ai Kontext
  const { url: editedUrl } = await editImage(sourceUrl, prompt);

  // 2. Download the edited image
  const imgRes = await fetch(editedUrl);
  if (!imgRes.ok) throw new Error("Failed to download edited image");
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const filename = `bruce-edit-${Date.now()}.${ext}`;

  // 3. Upload to Drive (fallback to the fal-hosted URL if Drive is unavailable)
  let displayUrl = editedUrl;
  try {
    displayUrl = await uploadImageToPersonalFolder(userId, imgBuffer, contentType, filename);
  } catch {
    // Drive unavailable — use the temporary fal URL
  }

  // 4. Save the image message to the DB
  const adminSupabase = createServiceRoleClient();
  const { data: msg, error } = await adminSupabase
    .from("messages")
    .insert({
      chat_id: chatId,
      sender_id: null,
      role: "assistant",
      content: `[Edited image: ${prompt.substring(0, 100)}]`,
      metadata: {
        content_type: "image",
        image_url: displayUrl,
        prompt,
        model: "fal-ai/flux-pro/kontext",
        quality: "standard",
      },
    })
    .select("id")
    .single();

  if (error || !msg) throw new Error("Failed to save edited image to DB");

  return { url: displayUrl, messageId: msg.id as string };
}
