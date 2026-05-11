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

  const supabasePromise = (async () => {
    try {
      const { error } = await adminSupabase.storage
        .from("message-images")
        .upload(filePath, Buffer.from(base64, "base64"), { contentType: mediaType, upsert: false });
      if (!error) {
        const { data } = adminSupabase.storage.from("message-images").getPublicUrl(filePath);
        return data.publicUrl;
      }
    } catch { /* silent */ }
    return "";
  })();

  const [file_id, url] = await Promise.all([anthropicPromise, supabasePromise]);
  return Response.json({ file_id, url });
}
