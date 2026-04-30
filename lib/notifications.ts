import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushNotification } from "@/lib/firebase/server";

// Returns true if the user has a presence heartbeat for chatId within 30 min.
async function isActiveInChat(userId: string, chatId: string): Promise<boolean> {
  const adminSupabase = createServiceRoleClient();
  const threshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
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
// table. Silently skips if the user has no FCM token or is active in the chat.
export async function notifyUser({
  userId,
  senderId,
  title,
  body,
  type,
  url,
  metadata,
  suppressIfActiveInChatId,
}: {
  userId: string;
  senderId?: string; // notification skipped if userId === senderId
  title: string;
  body: string;
  type: string;
  url: string;
  metadata?: Record<string, unknown>;
  suppressIfActiveInChatId?: string;
}): Promise<void> {
  if (senderId && userId === senderId) return;

  const adminSupabase = createServiceRoleClient();

  const { data: userRow } = await adminSupabase
    .from("users")
    .select("fcm_token")
    .eq("id", userId)
    .single();

  if (!userRow?.fcm_token) return;

  if (suppressIfActiveInChatId) {
    const active = await isActiveInChat(userId, suppressIfActiveInChatId);
    if (active) return;
  }

  // Insert the notification row first to get a stable ID. That ID becomes the
  // FCM notification tag so duplicate deliveries from FCM coalesce into one
  // displayed notification rather than appearing twice.
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
