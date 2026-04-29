import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ token: string }>;
}

// Public endpoint — no auth required.
// New users don't have a session yet when they hit the /join page.
export async function GET(_req: NextRequest, { params }: Props) {
  const { token } = await params;

  if (!token) {
    return NextResponse.json({ error: "Token required" }, { status: 400 });
  }

  // Use service role — the anon SELECT policy covers non-expired/unused tokens,
  // but service role is simpler here since we're on the server and need reliable reads.
  const adminSupabase = createServiceRoleClient();

  const { data, error } = await adminSupabase
    .from("invite_tokens")
    .select("id, email, role, used, expires_at, created_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }

  if (data.used) {
    return NextResponse.json({ error: "Invite already used" }, { status: 404 });
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 404 });
  }

  return NextResponse.json({
    email: data.email as string | null,
    role: data.role as string,
    expires_at: data.expires_at as string,
  });
}
