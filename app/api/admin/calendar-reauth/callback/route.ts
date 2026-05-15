// Handles the Google OAuth callback for the calendar reauth flow.
// Exchanges the authorization code for tokens, then stores the refresh
// token in system_config under key 'family_calendar_refresh_token'.
//
// This route is public in middleware (Google redirects here without a
// session cookie), but it validates the CSRF state cookie set during
// initiation to confirm the request is legitimate.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export async function GET(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `https://${forwardedHost}`
    : request.nextUrl.origin;

  function redirect(path: string) {
    return NextResponse.redirect(`${origin}${path}`);
  }

  const { searchParams } = request.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    console.error("[calendar-reauth/callback] Google returned error:", error);
    return redirect("/admin/calendar-reauth?error=google_denied");
  }

  if (!code || !state) {
    return redirect("/admin/calendar-reauth?error=missing_params");
  }

  // Verify CSRF state cookie
  const cookieStore = await cookies();
  const storedState = cookieStore.get("cal_reauth_state")?.value;
  cookieStore.delete("cal_reauth_state");

  if (!storedState || storedState !== state) {
    console.error("[calendar-reauth/callback] state mismatch — possible CSRF");
    return redirect("/admin/calendar-reauth?error=state_mismatch");
  }

  // Exchange code for tokens
  const redirectUri = `${origin}/api/admin/calendar-reauth/callback`;
  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      code,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[calendar-reauth/callback] token exchange failed", {
      status: tokenRes.status,
      body,
    });
    return redirect("/admin/calendar-reauth?error=exchange_failed");
  }

  const tokenData = (await tokenRes.json()) as {
    access_token:  string;
    refresh_token?: string;
    expires_in:    number;
  };

  if (!tokenData.refresh_token) {
    // Google only returns a refresh_token when prompt=consent was used and the
    // authorization completed successfully. If it's missing, the user likely
    // denied the consent or Google skipped it (e.g., previously granted and
    // not forced via prompt=consent).
    console.error("[calendar-reauth/callback] no refresh_token in response");
    return redirect("/admin/calendar-reauth?error=no_refresh_token");
  }

  // Store in system_config using service role (bypasses RLS)
  const adminSupabase = createServiceRoleClient();
  const { error: upsertErr } = await adminSupabase
    .from("system_config")
    .upsert(
      { key: "family_calendar_refresh_token", value: tokenData.refresh_token },
      { onConflict: "key" }
    );

  if (upsertErr) {
    console.error("[calendar-reauth/callback] system_config upsert failed", {
      message: upsertErr.message,
      code:    upsertErr.code,
    });
    return redirect("/admin/calendar-reauth?error=store_failed");
  }

  console.log("[calendar-reauth/callback] refresh token stored successfully");
  return redirect("/admin/calendar-reauth?success=true");
}
