// Browserbase session lifecycle + Supabase persistence for the shared
// inline browser. One active session per chat_id. The Browserbase session is
// the single source of truth that BOTH Bruce (via Stagehand) and household
// members (via the Live View iframe) share — we never spin up a second session
// for Bruce's tool calls; they reconnect to this one by id.
//
// All DB access here uses the service-role client (RLS is bypassed server-side;
// the API routes do their own auth gating before calling in).

import Browserbase from "@browserbasehq/sdk";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Lazily constructed so an unset key at build/import time never throws — only
// actual session calls require credentials.
let _bb: Browserbase | null = null;
function bbClient(): Browserbase {
  if (!_bb) _bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });
  return _bb;
}

export interface ActiveBrowserSession {
  sessionId: string;
  liveViewUrl: string;
  currentUrl: string;
}

export async function createBrowserSession(
  chatId: string,
  createdBy: string
): Promise<{ sessionId: string; liveViewUrl: string }> {
  // keepAlive prevents the session from idling out during slow chats while a
  // member is reading the page between Bruce's actions.
  const session = await bbClient().sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    keepAlive: true,
  });

  // Live View URL is served from the Browserbase domain, so embedding it in an
  // iframe bypasses X-Frame-Options on the target site. debuggerFullscreenUrl
  // is the clean full-bleed embed (no devtools chrome) intended for Live View.
  const debugInfo = await bbClient().sessions.debug(session.id);
  const liveViewUrl = debugInfo.debuggerFullscreenUrl;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("browser_sessions").insert({
    chat_id: chatId,
    browserbase_session_id: session.id,
    live_view_url: liveViewUrl,
    current_url: "about:blank",
    created_by: createdBy,
    is_active: true,
  });
  if (error) {
    console.error("[browserbase] failed to persist session:", error.message);
  }

  return { sessionId: session.id, liveViewUrl };
}

export async function getActiveBrowserSession(
  chatId: string
): Promise<ActiveBrowserSession | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("browser_sessions")
    .select("browserbase_session_id, live_view_url, current_url")
    .eq("chat_id", chatId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    sessionId: data.browserbase_session_id as string,
    liveViewUrl: data.live_view_url as string,
    currentUrl: (data.current_url as string) ?? "about:blank",
  };
}

// System-prompt block injected by chat routes when a live session exists, so
// Bruce knows the panel is already open and what it's currently showing.
export async function getBrowserContextBlock(
  chatId: string | null
): Promise<string | undefined> {
  if (!chatId) return undefined;
  const session = await getActiveBrowserSession(chatId);
  if (!session) return undefined;
  return `BROWSER SESSION ACTIVE
The user can see a live browser panel in this chat. Current URL: ${session.currentUrl}
You and the user share this one browser — use the browse_page tool to navigate, act, or extract, and coordinate naturally. The user may have clicked or typed since your last action, so don't assume the page is unchanged.`;
}

export async function updateSessionUrl(chatId: string, url: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("browser_sessions")
    .update({ current_url: url })
    .eq("chat_id", chatId)
    .eq("is_active", true);
}

export async function endBrowserSession(chatId: string): Promise<void> {
  const session = await getActiveBrowserSession(chatId);
  if (!session) return;

  // Release the Browserbase session so billing stops. May already be expired —
  // never throw, just mark inactive in our DB regardless.
  try {
    await bbClient().sessions.update(session.sessionId, {
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      status: "REQUEST_RELEASE",
    });
  } catch {
    // Session may already be expired or released — ignore.
  }

  const supabase = createServiceRoleClient();
  await supabase
    .from("browser_sessions")
    .update({ is_active: false, ended_at: new Date().toISOString() })
    .eq("chat_id", chatId)
    .eq("is_active", true);
}
