import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { uploadToAnthropicFiles } from "@/lib/anthropic/uploadFile";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    base64: string;
    mediaType: string;
    filename: string;
    type: "image" | "document";
    isIncognito: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { base64, mediaType, filename, type, isIncognito } = body;

  const anthropicPromise = uploadToAnthropicFiles(base64, mediaType, filename);

  if (isIncognito) {
    const file_id = await anthropicPromise;
    return Response.json({ file_id, url: "" });
  }

  const adminSupabase = createServiceRoleClient();
  const fileExt = type === "image"
    ? (mediaType.split("/")[1] ?? "jpg")
    : (filename.split(".").pop() ?? "bin");
  const filePath = `${user.id}/${Date.now()}.${fileExt}`;

  const [file_id, storageResult] = await Promise.all([
    anthropicPromise,
    adminSupabase.storage
      .from("message-images")
      .upload(filePath, Buffer.from(base64, "base64"), { contentType: mediaType, upsert: false }),
  ]);

  if (storageResult.error) {
    return new Response(`Storage upload failed: ${storageResult.error.message}`, { status: 500 });
  }

  const { data: urlData } = adminSupabase.storage.from("message-images").getPublicUrl(filePath);
  return Response.json({ file_id, url: urlData.publicUrl });
}
