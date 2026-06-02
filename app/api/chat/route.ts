import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  generateChatTitle,
} from "@/lib/anthropic";
import { parsePastedAttachments, stripPastedSummaries } from "@/lib/chat/pastedText";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
import {
  runChatStream,
  sanitizeAlternatingMessages,
  TOOLS_FULL,
} from "@/lib/chat/streamHandler";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    message: string;
    chatId: string | null;
    isIncognito: boolean;
    currentLocation?: string;
    userTimestamp?: string;
    attachments?: Array<{ file_id: string | null; url: string; type: "image" | "document"; filename: string }>;
    /** When creating a new chat, assign it to this project (membership-validated). */
    projectId?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { message, chatId, isIncognito, currentLocation, userTimestamp: rawTimestamp, attachments: rawAttachments, projectId: rawProjectId } = body;
  const attachments = rawAttachments ?? [];
  const userTimestamp = rawTimestamp ?? new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  if (!message?.trim() && attachments.length === 0) {
    return new Response("Message required", { status: 400 });
  }

  const { block: memoryBlock } = await assembleMemoryBlock(supabase, user.id);

  type HistoryEntry = { role: string; content: string | Anthropic.Messages.ContentBlockParam[] };
  let history: HistoryEntry[] = [];
  if (chatId) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("role, content, metadata, file_ids")
      .eq("chat_id", chatId)
      .order("created_at", { ascending: true });
    history = (msgs ?? []).map((m) => {
      const meta = m.metadata as Record<string, unknown> | null;
      if (meta?.content_type === "image") {
        return { role: m.role as string, content: "[image generated]" };
      }
      const text = (m.content as string) ?? "";
      const metaAttachments = meta?.attachments as Array<{ type: string; filename?: string }> | undefined;
      const fileIds = m.file_ids as (string | null)[] | null;

      if (fileIds && fileIds.length > 0 && metaAttachments && metaAttachments.length > 0) {
        const blocks: Anthropic.Messages.ContentBlockParam[] = [];
        for (let i = 0; i < fileIds.length; i++) {
          const fileId = fileIds[i];
          const att = metaAttachments[i];
          if (!fileId || !att) continue;
          if (att.type === "image") {
            blocks.push({ type: "image", source: { type: "file", file_id: fileId } } as unknown as Anthropic.Messages.ContentBlockParam);
          } else {
            blocks.push({ type: "document", source: { type: "file", file_id: fileId }, title: att.filename ?? "document" } as unknown as Anthropic.Messages.ContentBlockParam);
          }
        }
        if (text.trim()) blocks.push({ type: "text", text });
        if (blocks.length > 0) return { role: m.role as string, content: blocks };
      }

      if (metaAttachments && metaAttachments.length > 0 && !text.trim()) {
        const desc = metaAttachments
          .map((a) => a.type === "document" ? `[document: ${a.filename ?? "file"}]` : "[image]")
          .join(", ");
        return { role: m.role as string, content: desc };
      }

      // Reconstruct pasted content so Bruce sees the actual text in follow-up turns.
      // The DB stores only a summary label in content; the real text is in metadata.pastedAttachments.
      const pastedMeta = meta?.pastedAttachments as Array<{ content: string }> | undefined;
      if (pastedMeta && pastedMeta.length > 0) {
        const userText = stripPastedSummaries(text);
        const blocks = pastedMeta
          .map((a) => `<attached_text filename="pasted-text.txt">\n${a.content}\n</attached_text>`)
          .join("\n\n");
        const fullContent = userText.trim() ? `${blocks}\n\n${userText}` : blocks;
        return { role: m.role as string, content: fullContent };
      }

      return { role: m.role as string, content: text };
    }).filter((m) => {
      const c = m.content;
      return typeof c === "string" ? c.trim().length > 0 : Array.isArray(c) && c.length > 0;
    });
  }

  const { data: userProfile } = await supabase
    .from("users")
    .select("name, home_location, preferred_model")
    .eq("id", user.id)
    .single();
  const userName = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.name ?? "Member";
  const homeLocation = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.home_location ?? "Arlington, Virginia";
  const preferredModel = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.preferred_model ?? "claude-sonnet-4-6";

  const locationContext = currentLocation
    ? `${userName}'s current location right now is ${currentLocation}.`
    : `${userName}'s home location is ${homeLocation}. Use this as the default for any location-based questions.`;

  const adminSupabase = createServiceRoleClient();

  // Load pending reminders for passive awareness. Show overdue + next 48 hours.
  const remindersCutoff = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const { data: pendingReminders } = await adminSupabase
    .from("reminders")
    .select("content, remind_at")
    .eq("user_id", user.id)
    .is("completed_at", null)
    .lte("remind_at", remindersCutoff)
    .order("remind_at", { ascending: true })
    .limit(10);

  let remindersContext: string | undefined;
  if (pendingReminders && pendingReminders.length > 0) {
    const lines = (pendingReminders as { content: string; remind_at: string }[])
      .map((r) => {
        const formatted = new Date(r.remind_at).toLocaleString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        return `- ${r.content} — ${formatted}`;
      })
      .join("\n");
    remindersContext = `## ${userName}'s upcoming reminders\n${lines}`;
  }

  const systemPrompt = buildSystemPrompt({
    mode: "standalone",
    userName,
    userTimestamp,
    memoryBlock,
    locationContext,
    remindersContext,
    includeImageGen: true,
  });
  let currentChatId = chatId;
  let chatTitle: string | undefined;
  const { displayMessage, pastedAttachments } = parsePastedAttachments(message);

  const attachmentMeta = attachments.map((att) => ({
    url: att.url,
    type: att.type,
    filename: att.type === "document" ? att.filename : undefined,
  }));
  const fileIds = attachments.map((att) => att.file_id);

  let latestUserMessageId: string | null = null;

  if (!isIncognito) {
    if (!currentChatId) {
      // Optional project assignment at creation. The insert uses the service role
      // (bypasses RLS), so membership must be verified here with the user client.
      let assignedProjectId: string | null = null;
      if (typeof rawProjectId === "string" && rawProjectId) {
        const { data: membership } = await supabase
          .from("project_members")
          .select("id")
          .eq("project_id", rawProjectId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (membership) assignedProjectId = rawProjectId;
      }

      chatTitle = generateChatTitle(displayMessage);
      const { data: newChat, error: chatError } = await adminSupabase
        .from("chats")
        .insert({
          owner_id: user.id,
          project_id: assignedProjectId,
          type: "private",
          title: chatTitle,
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (chatError || !newChat) {
        console.error("[api/chat] Failed to create chat:", chatError);
        return new Response("Failed to create chat", { status: 500 });
      }
      currentChatId = newChat.id;
    }

    const firstAtt = attachments[0];
    const firstDocFilename = attachments.find((a) => a.type === "document")?.filename ?? null;
    const hasFileIds = fileIds.some(Boolean);
    const { data: insertedMsg, error: msgError } = await adminSupabase.from("messages").insert({
      chat_id: currentChatId,
      sender_id: user.id,
      role: "user",
      content: displayMessage,
      image_url: attachmentMeta[0]?.url ?? null,
      attachment_type: firstAtt?.type ?? null,
      attachment_filename: firstDocFilename,
      ...(() => { const m: Record<string, unknown> = {}; if (attachmentMeta.length > 0) m.attachments = attachmentMeta; if (pastedAttachments.length > 0) m.pastedAttachments = pastedAttachments; return Object.keys(m).length > 0 ? { metadata: m } : {}; })(),
      ...(hasFileIds ? { file_ids: fileIds } : {}),
    }).select("id").single();

    if (msgError) console.error("[api/chat] Failed to insert user message:", msgError);
    latestUserMessageId = (insertedMsg as { id: string } | null)?.id ?? null;
  }

  let userContent: Anthropic.Messages.MessageParam["content"];
  if (attachments.length > 0) {
    const blocks: Anthropic.Messages.ContentBlockParam[] = [];
    for (const att of attachments) {
      if (!att.file_id) continue;
      if (att.type === "image") {
        blocks.push({ type: "image", source: { type: "file", file_id: att.file_id } } as unknown as Anthropic.Messages.ContentBlockParam);
      } else {
        blocks.push({ type: "document", source: { type: "file", file_id: att.file_id }, title: att.filename } as unknown as Anthropic.Messages.ContentBlockParam);
      }
    }
    if (message.trim()) blocks.push({ type: "text" as const, text: message });
    if (blocks.length === 0) blocks.push({ type: "text" as const, text: message || "[attachment]" });
    userContent = blocks as Anthropic.Messages.MessageParam["content"];
  } else {
    userContent = message;
  }

  const anthropicMessages = sanitizeAlternatingMessages([
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content as Anthropic.Messages.MessageParam["content"],
      })),
    { role: "user" as const, content: userContent },
  ]);

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": "files-api-2025-04-14" },
  });

  const responseHeaders: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  };
  if (currentChatId) responseHeaders["X-Chat-Id"] = currentChatId;
  if (chatTitle) responseHeaders["X-Chat-Title"] = encodeURIComponent(chatTitle);

  const stream = runChatStream({
    anthropic,
    model: preferredModel,
    maxTokens: 2048,
    systemPrompt,
    initialMessages: anthropicMessages,
    tools: TOOLS_FULL,
    userId: user.id,
    handleImageRequest: true,
    persist: {
      enabled: !isIncognito,
      adminSupabase,
      chatId: currentChatId,
      latestUserMessageId,
    },
    searchContext: { projectId: null },
  });

  return new Response(stream, { headers: responseHeaders });
}
