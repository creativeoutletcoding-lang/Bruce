// Initiates the Google OAuth flow to obtain a fresh refresh token for the
// shared Johnson family calendar account (johnson2016family@gmail.com).
//
// Protected: only Jake's user ID may call this route.
//
// IMPORTANT: Before using this route in production, add the following
// URI to the "Authorized redirect URIs" list in Google Cloud Console:
//   https://heybruce.app/api/admin/calendar-reauth/callback

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const JAKE_USER_ID = "d572fff1-d0db-44f2-915c-988ea1c21066";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.id !== JAKE_USER_ID) {
    return new Response("Forbidden", { status: 403 });
  }

  // Derive the origin from forwarded-host (same pattern as auth/callback)
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `https://${forwardedHost}`
    : request.nextUrl.origin;
  const redirectUri = `${origin}/api/admin/calendar-reauth/callback`;

  // CSRF protection: store a random state token in a short-lived cookie,
  // verified in the callback before any token exchange.
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID!,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         CALENDAR_SCOPE,
    access_type:   "offline",
    prompt:        "consent",  // forces Google to issue a new refresh token
    state,
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  const response = NextResponse.redirect(googleAuthUrl);
  response.cookies.set("cal_reauth_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600, // 10 minutes
    path:     "/",
  });

  return response;
}
