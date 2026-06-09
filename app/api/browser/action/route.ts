// Browser action endpoint — used by the human side of the shared browser
// (e.g. typing a URL in the panel's address bar and pressing Enter). Bruce's own
// actions go through the browse_page tool inside the chat stream, not here.
//
// Runs the Stagehand action against the chat's existing Browserbase session,
// then syncs the resulting URL back to Supabase so every member's panel URL bar
// updates via Realtime.

import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveBrowserSession, updateSessionUrl } from "@/lib/browser/browserbase";
import { performBrowserAction, type BrowserAction } from "@/lib/browser/stagehand";

export const runtime = "nodejs";
export const maxDuration = 60; // browser actions can take time

async function authorizeChatMember(chatId: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  // RLS hides chats the user can't read; if we can select it, they're allowed.
  const { data: chat } = await supabase
    .from("chats")
    .select("id")
    .eq("id", chatId)
    .maybeSingle();
  return Boolean(chat);
}

export async function POST(req: NextRequest) {
  let body: { chatId?: string; action?: BrowserAction; url?: string; instruction?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { chatId, action, url, instruction } = body;
  if (!chatId || !action) {
    return Response.json({ error: "chatId and action required" }, { status: 400 });
  }

  if (!(await authorizeChatMember(chatId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const session = await getActiveBrowserSession(chatId);
  if (!session) {
    return Response.json({ error: "No active browser session for this chat" }, { status: 404 });
  }

  const actionResult = await performBrowserAction(session.sessionId, action, { url, instruction });

  if (actionResult.currentUrl && actionResult.currentUrl !== "about:blank") {
    await updateSessionUrl(chatId, actionResult.currentUrl);
  }

  return Response.json(actionResult);
}
