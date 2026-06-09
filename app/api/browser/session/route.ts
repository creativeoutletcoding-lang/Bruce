// Browser session lifecycle endpoint.
//   POST   — create (or no-op return) the shared Browserbase session for a chat
//   DELETE — release the session and mark it inactive
//
// Auth: the caller must be a member of the chat. We let the DB RLS policy be the
// hard wall (insert/update are gated by browser_sessions RLS for user clients),
// but here we additionally verify membership before using the service role so a
// non-member can't create a session for someone else's chat.

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createBrowserSession,
  endBrowserSession,
  getActiveBrowserSession,
} from "@/lib/browser/browserbase";

export const runtime = "nodejs";
export const maxDuration = 30;

async function authorizeChatMember(chatId: string): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Owner of the chat?
  const { data: chat } = await supabase
    .from("chats")
    .select("id, owner_id")
    .eq("id", chatId)
    .maybeSingle();
  if (chat && (chat as { owner_id: string }).owner_id === user.id) return user.id;

  // Or an explicit chat member (group/family/thread)?
  const { data: membership } = await supabase
    .from("chat_members")
    .select("user_id")
    .eq("chat_id", chatId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership) return user.id;

  // RLS on `chats` already hides chats the user can't see, so if we found a chat
  // row above it means the user can read it; allow members of readable chats.
  if (chat) return user.id;

  return null;
}

export async function POST(req: NextRequest) {
  let body: { chatId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { chatId } = body;
  if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });

  const userId = await authorizeChatMember(chatId);
  if (!userId) return Response.json({ error: "Forbidden" }, { status: 403 });

  // One active session per chat — return the existing one if present.
  const existing = await getActiveBrowserSession(chatId);
  if (existing) {
    return Response.json({
      sessionId: existing.sessionId,
      liveViewUrl: existing.liveViewUrl,
      currentUrl: existing.currentUrl,
    });
  }

  const { sessionId, liveViewUrl } = await createBrowserSession(chatId, userId);
  return Response.json({ sessionId, liveViewUrl });
}

export async function DELETE(req: NextRequest) {
  let body: { chatId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { chatId } = body;
  if (!chatId) return Response.json({ error: "chatId required" }, { status: 400 });

  const userId = await authorizeChatMember(chatId);
  if (!userId) return Response.json({ error: "Forbidden" }, { status: 403 });

  await endBrowserSession(chatId);
  return Response.json({ success: true });
}
