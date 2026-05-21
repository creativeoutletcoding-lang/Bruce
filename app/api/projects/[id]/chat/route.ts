import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  assembleMemoryBlock,
  buildMemberCombination,
  generateChatTitle,
} from "@/lib/anthropic";
import { parsePastedAttachments } from "@/lib/chat/pastedText";
import { buildSystemPrompt } from "@/lib/chat/buildSystemPrompt";
import {
  runChatStream,
  sanitizeAlternatingMessages,
  TOOLS_FULL,
} from "@/lib/chat/streamHandler";
import { getFileContent } from "@/lib/google/drive";
import { notifyUser } from "@/lib/notifications";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id: projectId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let body: {
    message: string;
    chatId: string | null;
    currentLocation?: string;
    userTimestamp?: string;
    attachments?: Array<{ file_id: string | null; url: string; type: "image" | "document"; filename: string }>;
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select(
      `id, name, instructions, isolate_memory,
       project_members(user_id),
       files(id, name, google_drive_file_id, mime_type)`
    )
    .eq("id", projectId)
    .single();

  if (projectError || !project) return new Response("Project not found", { status: 404 });

  const { data: userProfile } = await supabase
    .from("users")
    .select("name, home_location, preferred_model")
    .eq("id", user.id)
    .single();
  const userName = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.name ?? "Unknown";
  const homeLocation = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.home_location ?? "Arlington, Virginia";
  const preferredModel = (userProfile as { name: string; home_location: string | null; preferred_model: string | null } | null)?.preferred_model ?? "claude-sonnet-4-6";

  const adminSupabase = createServiceRoleClient();
  const memberUserIds = (project.project_members as Array<{ user_id: string }>).map((m) => m.user_id);
  const isolateMemory = !!(project.isolate_memory as boolean | null);
  const memberCombination = memberUserIds.length > 1 ? buildMemberCombination(memberUserIds) : undefined;

  const { data: memberProfiles } = await adminSupabase
    .from("users")
    .select("name")
    .in("id", memberUserIds);
  const memberNames = (memberProfiles ?? []).map((p) => p.name as string);

  type FileRow = { id: string; name: string; google_drive_file_id: string; mime_type: string | null };
  const attachedFiles = (project.files as FileRow[]) ?? [];
  const fileNames = attachedFiles.map((f) => f.name);

  const FILE_CHAR_CAP = 25000;
  let fileContentBlock = "";
  let totalFileChars = 0;
  let skippedCount = 0;

  for (const file of attachedFiles) {
    if (totalFileChars >= FILE_CHAR_CAP) { skippedCount++; continue; }
    try {
      const content = await getFileContent(user.id, file.google_drive_file_id);
      if (content) {
        const remaining = FILE_CHAR_CAP - totalFileChars;
        const snippet = content.length > remaining ? content.substring(0, remaining) + "... [truncated]" : content;
        fileContentBlock += `File: ${file.name}\n${snippet}\n---\n`;
        totalFileChars += snippet.length;
      }
    } catch { /* Drive unavailable — skip */ }
  }

  if (skippedCount > 0) {
    fileContentBlock += `[${skippedCount} additional file${skippedCount > 1 ? "s" : ""} attached but not loaded — ask to reference them]`;
  }

  const { block: memoryBlock } = await assembleMemoryBlock(supabase, user.id, {
    memberCombination,
    projectId,
    isolateMemory,
  });

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
        const desc = metaAttachments.map((a) => a.type === "document" ? `[document: ${a.filename ?? "file"}]` : "[image]").join(", ");
        return { role: m.role as string, content: desc };
      }
      return { role: m.role as string, content: text };
    }).filter((m) => {
      const c = m.content;
      return typeof c === "string" ? c.trim().length > 0 : Array.isArray(c) && c.length > 0;
    });
  }

  const locationContext = currentLocation
    ? `${userName}'s current location right now is ${currentLocation}.`
    : `${userName}'s home location is ${homeLocation}. Use this as the default for any location-based questions.`;

  const systemPrompt = buildSystemPrompt({
    mode: "project",
    userName,
    userTimestamp,
    memoryBlock,
    locationContext,
    includeImageGen: true,
    project: {
      name: project.name as string,
      instructions: project.instructions as string,
      memberNames,
      fileNames,
      fileContentBlock: fileContentBlock || undefined,
    },
  });

  let currentChatId = chatId;
  const isFirstMessage = history.length === 0;

  if (!currentChatId) {
    const { data: newChat, error: chatError } = await adminSupabase
      .from("chats")
      .insert({
        owner_id: user.id,
        project_id: projectId,
        type: "private",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (chatError || !newChat) {
      console.error("[api/projects/chat] Failed to create chat:", chatError);
      return new Response("Failed to create chat", { status: 500 });
    }
    currentChatId = newChat.id;
  }

  const { displayMessage, pastedAttachments } = parsePastedAttachments(message);

  let chatTitle: string | undefined;
  if (isFirstMessage) {
    chatTitle = generateChatTitle(displayMessage);
    const { error: titleErr } = await adminSupabase
      .from("chats")
      .update({ title: chatTitle })
      .eq("id", currentChatId!);
    if (titleErr) console.error("[api/projects/chat] Failed to save title:", titleErr);
  }

  const attachmentMeta = attachments.map((att) => ({
    url: att.url,
    type: att.type,
    filename: att.type === "document" ? att.filename : undefined,
  }));
  const fileIds = attachments.map((att) => att.file_id);

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

  if (msgError) console.error("[api/projects/chat] Failed to insert user message:", msgError);
  const latestUserMessageId = (insertedMsg as { id: string } | null)?.id ?? null;

  // Thread-follow notifications: only notify project members who have already
  // participated in this specific chat thread (not all project members).
  // Query after inserting so the current user is included for Bruce responses.
  let threadParticipantIds: string[] = [];
  const projectNotifUrl = `https://heybruce.app/projects/${projectId}/chat/${currentChatId}`;

  if (memberUserIds.length > 1 && currentChatId) {
    const { data: participantRows } = await adminSupabase
      .from("messages")
      .select("sender_id")
      .eq("chat_id", currentChatId)
      .not("sender_id", "is", null);

    threadParticipantIds = [
      ...new Set((participantRows ?? []).map((r) => r.sender_id as string)),
    ];

    // Notify other thread participants about the human message.
    const humanNotifBody = displayMessage.length > 120
      ? displayMessage.slice(0, 120) + "…"
      : displayMessage;
    const humanRecipients = threadParticipantIds.filter((id) => id !== user.id);

    await Promise.all(
      humanRecipients.map((recipientId) =>
        notifyUser({
          userId: recipientId,
          senderId: user.id,
          title: userName,
          body: humanNotifBody || (attachments.length > 0 ? `Sent ${attachments.length === 1 ? "a file" : `${attachments.length} files`}` : ""),
          type: "message",
          url: projectNotifUrl,
          category: "project_message",
          suppressIfActiveInChatId: currentChatId ?? undefined,
        })
      )
    );
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
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as Anthropic.Messages.MessageParam["content"] })),
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
    "X-Chat-Id": currentChatId!,
  };
  if (chatTitle) responseHeaders["X-Chat-Title"] = encodeURIComponent(chatTitle);

  const bruceNotifRecipients = threadParticipantIds;

  const stream = runChatStream({
    anthropic,
    model: preferredModel,
    maxTokens: 16000,
    systemPrompt,
    initialMessages: anthropicMessages,
    tools: TOOLS_FULL,
    userId: user.id,
    handleImageRequest: true,
    persist: {
      enabled: true,
      adminSupabase,
      chatId: currentChatId,
      latestUserMessageId,
    },
    searchContext: { projectId },
    onComplete: bruceNotifRecipients.length > 0
      ? async (responseText) => {
          const body = responseText.length > 120 ? responseText.slice(0, 120) + "…" : responseText;
          await Promise.all(
            bruceNotifRecipients.map((recipientId) =>
              notifyUser({
                userId: recipientId,
                title: "Bruce",
                body,
                type: "message",
                url: projectNotifUrl,
                category: "bruce_response",
                suppressIfActiveInChatId: currentChatId ?? undefined,
              })
            )
          );
        }
      : undefined,
  });

  return new Response(stream, { headers: responseHeaders });
}
