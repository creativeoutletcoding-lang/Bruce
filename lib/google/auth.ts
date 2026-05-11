// Shared Google OAuth token management.
// All Google API modules (drive, gmail, sheets, docs) use this.
import { createServiceRoleClient } from "@/lib/supabase/server";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function getValidToken(userId: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from("users")
    .select("google_access_token, google_refresh_token, google_token_expires_at")
    .eq("id", userId)
    .single();

  if (!user?.google_refresh_token) {
    throw new Error(
      "Google authorization required. Please sign out and sign back in."
    );
  }

  const expiresAt = user.google_token_expires_at
    ? new Date(user.google_token_expires_at)
    : null;
  const now = Date.now();

  if (
    user.google_access_token &&
    expiresAt &&
    expiresAt.getTime() - now > REFRESH_BUFFER_MS
  ) {
    return user.google_access_token;
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: user.google_refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(
      "Google authorization expired. Please sign out and sign back in."
    );
  }

  const tokenData = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  const newExpiresAt = new Date(now + tokenData.expires_in * 1000).toISOString();

  await supabase
    .from("users")
    .update({
      google_access_token: tokenData.access_token,
      google_token_expires_at: newExpiresAt,
    })
    .eq("id", userId);

  return tokenData.access_token;
}
