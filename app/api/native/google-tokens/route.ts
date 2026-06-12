// Native-shell only: persist the Google connector tokens (Calendar/Gmail/Drive)
// obtained from a client-side PKCE exchange in the Capacitor shell.
//
// The web login flow stores these in app/auth/callback/route.ts from the OAuth
// callback. The native flow finishes the exchange client-side (Universal Link
// deep link), so the provider tokens never pass through that server route — this
// endpoint mirrors the same write. Authenticated via the session cookie that the
// client-side exchange just established; the user can only update their own row.
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { access_token?: string | null; refresh_token?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const accessToken = body.access_token ?? null;
  const refreshToken = body.refresh_token ?? null;
  if (!accessToken && !refreshToken) {
    return NextResponse.json({ error: "no_tokens" }, { status: 400 });
  }

  // Access tokens are short-lived (~1h); refresh tokens are persistent.
  const tokenExpiry = accessToken
    ? new Date(Date.now() + 3600 * 1000).toISOString()
    : null;

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("users")
    .update({
      ...(accessToken ? { google_access_token: accessToken } : {}),
      ...(refreshToken ? { google_refresh_token: refreshToken } : {}),
      ...(tokenExpiry ? { google_token_expires_at: tokenExpiry } : {}),
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
