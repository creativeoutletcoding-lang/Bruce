import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { AdminDevMessage, AdminDevSession, AdminDevSessionWithMeta } from "@/lib/types";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  return profile?.role === "admin";
}

export async function GET() {
  if (!(await isAdmin())) return new Response("Forbidden", { status: 403 });

  const serviceSupabase = createServiceRoleClient();

  const [{ data: sessions, error: sessError }, { data: messages, error: msgError }] =
    await Promise.all([
      serviceSupabase
        .from("admin_dev_sessions")
        .select("*")
        .order("updated_at", { ascending: false }),
      serviceSupabase
        .from("admin_dev_messages")
        .select("session_id, content, created_at")
        .not("session_id", "is", null)
        .order("created_at", { ascending: false }),
    ]);

  if (sessError || msgError) {
    console.error("[admin/dev/sessions] GET error", { sessError, msgError });
    return new Response("DB error", { status: 500 });
  }

  // Compute message_count and last_message_preview per session
  const countMap = new Map<string, number>();
  const previewMap = new Map<string, string>();
  for (const m of (messages ?? []) as Array<Pick<AdminDevMessage, "session_id" | "content" | "created_at">>) {
    if (!m.session_id) continue;
    countMap.set(m.session_id, (countMap.get(m.session_id) ?? 0) + 1);
    // messages are ordered DESC so the first we see per session is the most recent
    if (!previewMap.has(m.session_id)) {
      previewMap.set(m.session_id, m.content.slice(0, 100));
    }
  }

  const result: AdminDevSessionWithMeta[] = (sessions ?? []).map(
    (s: AdminDevSession) => ({
      ...s,
      message_count: countMap.get(s.id) ?? 0,
      last_message_preview: previewMap.get(s.id) ?? null,
    })
  );

  return Response.json(result);
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return new Response("Forbidden", { status: 403 });

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const name = body.name?.trim() || formatDateName();
  const serviceSupabase = createServiceRoleClient();

  const { data, error } = await serviceSupabase
    .from("admin_dev_sessions")
    .insert({ name })
    .select()
    .single();

  if (error) {
    console.error("[admin/dev/sessions] POST error", error);
    return new Response("DB error", { status: 500 });
  }
  return Response.json(data, { status: 201 });
}

function formatDateName(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}
