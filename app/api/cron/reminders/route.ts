import { createServiceRoleClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

// Called by the DigitalOcean droplet on a 1-minute PM2 cron schedule.
// Secured with CRON_SECRET so only the droplet can trigger it.
//
// PM2 ecosystem.config.js example:
//   { script: 'curl', args: ['-s', '-X', 'POST',
//     '-H', 'x-cron-secret: <CRON_SECRET>',
//     'https://heybruce.app/api/cron/reminders'],
//     cron_restart: '* * * * *', autorestart: false }

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const adminSupabase = createServiceRoleClient();

  const { data: dueReminders, error } = await adminSupabase
    .from("reminders")
    .select("id, user_id, content, remind_at")
    .is("completed_at", null)
    .is("notified_at", null)
    .lte("remind_at", new Date().toISOString());

  if (error) {
    console.error("[cron/reminders] fetch error:", error.message);
    return new Response("Error", { status: 500 });
  }

  if (!dueReminders || dueReminders.length === 0) {
    return Response.json({ fired: 0 });
  }

  let fired = 0;

  await Promise.all(
    (dueReminders as { id: string; user_id: string; content: string; remind_at: string }[]).map(
      async (reminder) => {
        try {
          await notifyUser({
            userId: reminder.user_id,
            title: "Reminder",
            body: reminder.content,
            type: "reminder",
            url: "/",
            metadata: { reminderId: reminder.id },
          });

          await adminSupabase
            .from("reminders")
            .update({ notified_at: new Date().toISOString() })
            .eq("id", reminder.id);

          fired++;
        } catch (err) {
          console.error(`[cron/reminders] failed for ${reminder.id}:`, err);
        }
      }
    )
  );

  return Response.json({ fired });
}
