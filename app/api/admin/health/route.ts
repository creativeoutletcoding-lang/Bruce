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
  const checkedAt = new Date().toISOString();

  const yesterday = new Date(Date.now() - 86400000).toISOString();

  const [supabaseCheck, messages24h, users] = await Promise.all([
    admin.from("messages").select("id", { count: "exact", head: true }),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", yesterday),
    admin
      .from("users")
      .select("id, name, google_access_token, google_refresh_token, google_token_expires_at")
      .eq("status", "active"),
  ]);

  const anthropicKeySet = !!process.env.ANTHROPIC_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "unknown";

  const googleStatuses = (users.data ?? []).map((u) => {
    const hasToken = !!u.google_refresh_token;
    const expired = u.google_token_expires_at
      ? new Date(u.google_token_expires_at) < new Date()
      : false;
    return {
      name: u.name,
      connected: hasToken,
      token_expired: expired,
    };
  });

  const anyGoogleConnected = googleStatuses.some((s) => s.connected);
  const allGoogleConnected = googleStatuses.every((s) => s.connected);

  const services = [
    {
      name: "Anthropic API",
      status: anthropicKeySet ? "ok" : "error",
      detail: anthropicKeySet ? "claude-sonnet-4-6 configured" : "API key missing",
      checked_at: checkedAt,
    },
    {
      name: "Supabase",
      status: supabaseCheck.error ? "error" : "ok",
      detail: supabaseCheck.error
        ? supabaseCheck.error.message
        : "Connected — DB responding",
      checked_at: checkedAt,
    },
    {
      name: "Vercel",
      status: "ok",
      detail: appUrl,
      checked_at: checkedAt,
    },
    {
      name: "Google Drive / Calendar",
      status: allGoogleConnected ? "ok" : anyGoogleConnected ? "partial" : "error",
      detail: googleStatuses
        .map((s) => `${s.name}: ${s.connected ? (s.token_expired ? "token expired" : "connected") : "not connected"}`)
        .join(", "),
      checked_at: checkedAt,
      members: googleStatuses,
    },
  ];

  return NextResponse.json({
    services,
    model: "claude-sonnet-4-6",
    messages_last_24h: messages24h.count ?? 0,
    errors_last_24h: 0,
    note: "Error count and response time are not yet tracked in the DB.",
  });
}
