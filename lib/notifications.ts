import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushNotification } from "@/lib/firebase/server";

export type NotifCategory =
  | "family_message"
  | "project_message"
  | "bruce_response";

interface NotifPrefs {
  paused?: boolean;           // master kill-switch; default false
  bruce_responses?: boolean;  // default true
  family_messages?: boolean;  // default true
  project_messages?: boolean; // default true
}

// Maps notification_sensitivity to a presence-window in milliseconds.
// high  → always deliver (window = 0, presence check skipped)
// medium → suppress if active in last 2 min (default)
// low   → suppress if active in last 10 min
const PRESENCE_WINDOW_MS: Record<string, number> = {
  high: 0,
  medium: 2 * 60 * 1000,
  low: 10 * 60 * 1000,
};

async function isActiveInChat(
  userId: string,
  chatId: string,
  windowMs: number
): Promise<boolean> {
  if (windowMs === 0) return false;
  const adminSupabase = createServiceRoleClient();
  const threshold = new Date(Date.now() - windowMs).toISOString();
  const { data } = await adminSupabase
    .from("user_presence")
    .select("updated_at")
    .eq("user_id", userId)
    .eq("chat_id", chatId)
    .gt("updated_at", threshold)
    .maybeSingle();
  return !!data;
}

// Sends a push notification to a single user and logs it to the notifications
// table. Skips if: same sender, no FCM token, preferences block it, or presence
// active within sensitivity window.
export async function notifyUser({
  userId,
  senderId,
  title,
  body,
  type,
  category,
  url,
  metadata,
  suppressIfActiveInChatId,
}: {
  userId: string;
  senderId?: string;
  title: string;
  body: string;
  type: string;
  /** Maps to notification_preferences keys for per-type opt-out. */
  category?: NotifCategory;
  url: string;
  metadata?: Record<string, unknown>;
  suppressIfActiveInChatId?: string;
}): Promise<void> {
  if (senderId && userId === senderId) return;

  const adminSupabase = createServiceRoleClient();

  const { data: userRow } = await adminSupabase
    .from("users")
    .select("fcm_token, notification_preferences, notification_sensitivity")
    .eq("id", userId)
    .single();

  if (!userRow?.fcm_token) return;

  // Preference gate — all keys default to enabled (true) when absent.
  const prefs = (userRow.notification_preferences ?? {}) as NotifPrefs;
  if (prefs.paused) return;
  if (category === "bruce_response"  && prefs.bruce_responses  === false) return;
  if (category === "family_message"  && prefs.family_messages  === false) return;
  if (category === "project_message" && prefs.project_messages === false) return;

  // Presence gate — window length depends on sensitivity setting.
  if (suppressIfActiveInChatId) {
    const sensitivity = (userRow.notification_sensitivity as string | null) ?? "medium";
    const windowMs = PRESENCE_WINDOW_MS[sensitivity] ?? PRESENCE_WINDOW_MS.medium;
    const active = await isActiveInChat(userId, suppressIfActiveInChatId, windowMs);
    if (active) return;
  }

  // Insert the notification row first to get a stable ID. That ID becomes the
  // FCM notification tag so duplicate deliveries coalesce into one banner.
  const { data: notifRow } = await adminSupabase
    .from("notifications")
    .insert({
      user_id: userId,
      type,
      content: body,
      metadata: metadata ?? {},
      chat_id: suppressIfActiveInChatId ?? null,
    })
    .select("id")
    .single();

  const data: Record<string, string> = { url };
  if (suppressIfActiveInChatId) data.chatId = suppressIfActiveInChatId;
  if (notifRow?.id) data.notificationId = notifRow.id;

  try {
    await sendPushNotification({ fcmToken: userRow.fcm_token, title, body, data });
  } catch (err) {
    console.error("[notifications] sendPushNotification failed for user", userId, err);
  }
}

// Parses @Name mentions from a message and returns matching user IDs.
// Matches household member first names case-insensitively.
export async function extractMentionedUserIds(
  message: string,
  excludeUserId?: string
): Promise<string[]> {
  const mentionMatches = message.match(/@([A-Za-z]+)/g);
  if (!mentionMatches || mentionMatches.length === 0) return [];

  const names = mentionMatches.map((m) => m.slice(1).toLowerCase());

  const adminSupabase = createServiceRoleClient();
  const { data: users } = await adminSupabase
    .from("users")
    .select("id, name")
    .eq("status", "active");

  if (!users) return [];

  return (users as { id: string; name: string }[])
    .filter((u) => {
      const firstName = u.name.split(" ")[0].toLowerCase();
      return names.includes(firstName) && u.id !== excludeUserId;
    })
    .map((u) => u.id);
}
