import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

// GET /api/notifications/unread
// Returns { count: number } — total unread notifications for the authenticated user.
// Called by the service worker on background push to drive the app badge from the
// DB rather than the tray (shown notification count), so clearAppBadge() on app
// open is the only thing that changes the badge, not tray dismiss/accumulation.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return new Response("Unauthorized", { status: 401 });

  const adminSupabase = createServiceRoleClient();
  const { count } = await adminSupabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("read", false);

  return Response.json({ count: count ?? 0 });
}
