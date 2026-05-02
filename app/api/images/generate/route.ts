import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateImageAndSave, type ImageQuality } from "@/lib/images/generate";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: { prompt: string; chatId: string; quality?: ImageQuality };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { prompt, chatId, quality } = body;
  if (!prompt?.trim()) return new Response("Prompt required", { status: 400 });
  if (!chatId) return new Response("chatId required", { status: 400 });

  try {
    const result = await generateImageAndSave(prompt, user.id, chatId, quality);
    return Response.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number })?.status;
    console.error(`[api/images/generate] Failed — status=${status ?? "unknown"} message="${msg}"`);
    return new Response("Image generation failed", { status: 500 });
  }
}
