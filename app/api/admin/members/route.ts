import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();

  const { data: users, error } = await admin
    .from("users")
    .select("id, name, email, role, status, avatar_url, color_hex, created_at, updated_at, deactivated_at, purge_at")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }

  // Get message counts per user (all time)
  const { data: msgCounts } = await admin
    .from("messages")
    .select("sender_id")
    .eq("role", "user")
    .not("sender_id", "is", null);

  const counts: Record<string, number> = {};
  for (const m of msgCounts ?? []) {
    if (m.sender_id) counts[m.sender_id] = (counts[m.sender_id] ?? 0) + 1;
  }

  // Last active = most recent message from each user
  const { data: lastMsgs } = await admin
    .from("messages")
    .select("sender_id, created_at")
    .eq("role", "user")
    .not("sender_id", "is", null)
    .order("created_at", { ascending: false });

  const lastActive: Record<string, string> = {};
  for (const m of lastMsgs ?? []) {
    if (m.sender_id && !lastActive[m.sender_id]) {
      lastActive[m.sender_id] = m.created_at;
    }
  }

  const result = (users ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    avatar_url: u.avatar_url,
    color_hex: u.color_hex,
    created_at: u.created_at,
    deactivated_at: u.deactivated_at,
    purge_at: u.purge_at,
    last_active: lastActive[u.id] ?? null,
    message_count: counts[u.id] ?? 0,
  }));

  return NextResponse.json(result);
}
