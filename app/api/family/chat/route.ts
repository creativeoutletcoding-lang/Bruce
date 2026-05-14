import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  buildFamilyChatSystemPrompt,
  buildMemberCombination,
} from "@/lib/anthropic";
import {
  runChatStream,
  sanitizeAlternatingMessages,
  TOOLS_FULL,
  buildToolSystemBlocks,
} from "@/lib/chat/streamHandler";
import { notifyUser } from "@/lib/notifications";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

// ── Bruce engagement logic (server-side, hard gate) ──────────────────────────

function isDirectlyAddressed(message: string): boolean {
  return /\bbruce\b/i.test(message);
}

function bruceAskedQuestion(history: Array<{ role: string; content: string }>): boolean {
  if (history.length === 0) return false;
  const last = history[history.length - 1];
  return last.role === "assistant" && last.content.includes("?");
}

function shouldBruceRespond(
  currentMessage: string,
  history: Array<{ role: string; content: string }>
): boolean {
  return isDirectlyAddressed(currentMessage) || bruceAskedQuestion(history);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    message: string;
    chatId: string;
    currentLocation?: string;
    userTimestamp?: string;
    attachments?: Array<{ base64: string; mediaType: string; filename: string; type: "image" | "document" }>;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { message, chatId, currentLocation, userTimestamp: rawTimestamp, attachments: rawAttachments } = body;
  const attachments = rawAttachments ?? [];
  const userTimestamp = rawTimestamp ?? new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  if (!message?.trim() && attachments.length === 0) return new Response("Message required", { status: 400 });
  if (!chatId) return new Response("chatId required", { status: 400 });

  const adminSupabase = createServiceRoleClient();

  const { data: senderProfile } = await adminSupabase
    .from("users")
    .select("name, home_location")
    .eq("id", user.id)
    .single();

  const senderName = (senderProfile as { name: string; home_location: string | null } | null)?.name ?? "Someone";
  const homeLocation = (senderProfile as { name: string; home_location: string | null } | null)?.home_location ?? "Arlington, Virginia";

  const { data: msgs } = await adminSupabase
    .from("messages")
    .select("role, content, sender_id, metadata")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(40);

  const history = ((msgs ?? []).reverse() as Array<{
    role: string;
    content: string;
    sender_id: string | null;
    metadata: Record<string, unknown> | null;
  }>).map((m) => {
    const text = m.content ?? "";
    const metaAttachments = m.metadata?.attachments as Array<{ type: string; filename?: string }> | undefined;
    if (metaAttachments && metaAttachments.length > 0 && !text.trim()) {
      const desc = metaAttachments
        .map((a) => a.type === "document" ? `[document: ${a.filename ?? "file"}]` : "[image]")
        .join(", ");
      return { role: m.role, content: desc, sender_id: m.sender_id };
    }
    return { role: m.role, content: text, sender_id: m.sender_id };
  }).filter((m) => m.content.trim().length > 0);

  const willRespond = shouldBruceRespond(message, history);

  const attachmentMeta: Array<{ url: string; type: string; filename?: string }> = [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    try {
      const fileExt = att.type === "image"
        ? (att.mediaType.split("/")[1] ?? "jpg")
        : (att.filename.split(".").pop() ?? "bin");
      const filePath = `${user.id}/${Date.now()}_${i}.${fileExt}`;
      const { error: uploadErr } = await adminSupabase.storage
        .from("message-images")
        .upload(filePath, Buffer.from(att.base64, "base64"), {
          contentType: att.mediaType,
          upsert: false,
        });
      if (!uploadErr) {
        const { data: urlData } = adminSupabase.storage.from("message-images").getPublicUrl(filePath);
        attachmentMeta.push({ url: urlData.publicUrl, type: att.type, filename: att.type === "document" ? att.filename : undefined });
      } else {
        attachmentMeta.push({ url: "", type: att.type, filename: att.type === "document" ? att.filename : undefined });
      }
    } catch {
      attachmentMeta.push({ url: "", type: att.type, filename: att.type === "document" ? att.filename : undefined });
    }
  }

  const firstAtt = attachments[0];
  const firstDocFilename = attachments.find((a) => a.type === "document")?.filename ?? null;
  const { error: msgErr } = await adminSupabase.from("messages").insert({
    chat_id: chatId,
    sender_id: user.id,
    role: "user",
    content: message,
    image_url: attachmentMeta[0]?.url ?? null,
    attachment_type: firstAtt?.type ?? null,
    attachment_filename: firstDocFilename,
    ...(attachmentMeta.length > 0 ? { metadata: { attachments: attachmentMeta } } : {}),
  });
  if (msgErr) console.error("[api/family/chat] Failed to insert user message:", msgErr);

  adminSupabase
    .from("chats")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", chatId)
    .then();

  const [{ data: chatRow }, { data: memberRows }] = await Promise.all([
    adminSupabase.from("chats").select("type").eq("id", chatId).single(),
    adminSupabase.from("chat_members").select("user_id").eq("chat_id", chatId),
  ]);

  const familyMemberIds = ((memberRows ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const familyCombination = familyMemberIds.length > 1 ? buildMemberCombination(familyMemberIds) : undefined;

  const notifUrl =
    (chatRow as { type: string } | null)?.type === "family_thread"
      ? `https://heybruce.app/family/threads/${chatId}`
      : "https://heybruce.app/family";

  const recipientIds = ((memberRows ?? []) as { user_id: string }[])
    .map((r) => r.user_id)
    .filter((id) => id !== user.id);

  const notifText = message.trim() || (attachments.length > 0 ? `Sent ${attachments.length === 1 ? "a file" : `${attachments.length} files`}` : "");
  const truncatedBody = notifText.length > 120 ? notifText.slice(0, 120) + "…" : notifText;

  await Promise.all(
    recipientIds.map((recipientId) =>
      notifyUser({
        userId: recipientId,
        senderId: user.id,
        title: senderName,
        body: truncatedBody,
        type: "message",
        url: notifUrl,
        suppressIfActiveInChatId: chatId,
      })
    )
  );

  if (!willRespond) {
    return new Response(null, {
      status: 200,
      headers: { "X-Bruce-Responded": "false" },
    });
  }

  const { block: memoryBlock } = await assembleMemoryBlock(supabase, user.id, {
    memberCombination: familyCombination,
  });

  const locationContext = currentLocation
    ? `${senderName}'s current location right now is ${currentLocation}.`
    : `${senderName}'s home location is ${homeLocation}. Use this as the default for any location-based questions.`;

  const systemPrompt =
    buildFamilyChatSystemPrompt(senderName, memoryBlock, userTimestamp) +
    `\n\n${locationContext}` +
    buildToolSystemBlocks({ includeImageGen: false });

  let userContent: Anthropic.Messages.MessageParam["content"];
  try {
    if (attachments.length > 0) {
      const blocks: Array<
        | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp"; data: string } }
        | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } | { type: "text"; media_type: "text/plain"; data: string }; title: string }
        | { type: "text"; text: string }
      > = [];
      for (const att of attachments) {
        if (att.type === "image") {
          blocks.push({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: att.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
              data: att.base64,
            },
          });
        } else {
          blocks.push({
            type: "document" as const,
            source: att.mediaType === "application/pdf"
              ? { type: "base64" as const, media_type: "application/pdf" as const, data: att.base64 }
              : { type: "text" as const, media_type: "text/plain" as const, data: att.base64 },
            title: att.filename,
          });
        }
      }
      if (message.trim()) blocks.push({ type: "text" as const, text: message });
      userContent = blocks as Anthropic.Messages.MessageParam["content"];
    } else {
      userContent = message;
    }
  } catch (contentErr) {
    console.error('[api/family/chat] content block construction failed:', contentErr);
    return new Response("Content processing failed", { status: 500 });
  }

  const anthropicMessages = sanitizeAlternatingMessages([
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user" as const, content: userContent },
  ]);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const stream = runChatStream({
    anthropic,
    model: "claude-sonnet-4-6",
    maxTokens: 2048,
    systemPrompt,
    initialMessages: anthropicMessages,
    tools: TOOLS_FULL,
    userId: user.id,
    handleImageRequest: false,
    persist: {
      enabled: true,
      adminSupabase,
      chatId,
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      "X-Bruce-Responded": "true",
    },
  });
}
