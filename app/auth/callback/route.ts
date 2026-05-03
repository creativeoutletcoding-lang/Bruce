import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ensureBruceFolders } from "@/lib/google/drive";

const CORE_MEMORIES = [
  { content: "Jake Johnson is the admin and builder of Bruce.", category: "personal" },
  { content: "Jake is 36 years old.", category: "personal" },
  { content: "Jake works as an account executive at Foundation Insurance Group (FIG).", category: "professional" },
  { content: "Jake is co-owner of Capital Petsitters (CPS) with his mother, Nana.", category: "professional" },
  { content: "Jake's household includes Laurianne (33), Jocelynn (16), Elliot (8), Henry (5), and Violette (5).", category: "personal" },
  { content: "Jake's mother Nana (69) lives nearby and co-owns CPS.", category: "personal" },
  { content: "Jake manages all technical infrastructure and settings for Bruce.", category: "professional" },
  { content: "Jake prefers technical, direct communication. Peer-level. No hand-holding.", category: "preference" },
];

export async function GET(request: NextRequest) {
  // Outer try-catch so unexpected throws surface as logged errors rather than silent 500s
  try {
    return await handleCallback(request);
  } catch (unexpectedErr) {
    console.error("[callback] UNHANDLED EXCEPTION:", {
      message: unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr),
      stack: unexpectedErr instanceof Error ? unexpectedErr.stack : undefined,
    });
    const fallbackUrl = new URL(request.url);
    return NextResponse.redirect(`${fallbackUrl.origin}/login?error=auth`);
  }
}

async function handleCallback(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const inviteToken = requestUrl.searchParams.get("invite_token");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";

  // Log env var presence (never log values)
  console.log("[callback] env_check", {
    hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseUrlPrefix: process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 30) ?? "(missing)",
    hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    anonKeyLength: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.length ?? 0,
    anonKeyPrefix: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 8) ?? "(empty)",
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    hasCode: !!code,
    hasInviteToken: !!inviteToken,
    forwardedHost: forwardedHost ?? "(none)",
    isLocalEnv,
    nodeEnv: process.env.NODE_ENV,
  });

  function buildRedirect(path: string) {
    if (isLocalEnv) return `${requestUrl.origin}${path}`;
    if (forwardedHost) return `https://${forwardedHost}${path}`;
    return `${requestUrl.origin}${path}`;
  }

  if (!code) {
    console.error("[callback] FAIL: no code param in URL. Full search params:", requestUrl.search);
    return NextResponse.redirect(buildRedirect("/login?error=auth"));
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  console.log("[callback] step=exchange_start");
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  console.log("[callback] step=exchange_done", {
    success: !error && !!data?.user,
    userId: data?.user?.id ?? "(none)",
    userEmail: data?.user?.email ?? "(none)",
    errorMessage: error?.message ?? "(none)",
    errorStatus: (error as { status?: number } | null)?.status ?? "(none)",
    errorCode: (error as { code?: string } | null)?.code ?? "(none)",
    hasSession: !!data?.session,
  });

  if (error || !data.user) {
    console.error("[callback] FAIL: exchangeCodeForSession failed", {
      errorMessage: error?.message,
      errorStack: error instanceof Error ? error.stack : "(no stack)",
      fullError: JSON.stringify(error),
    });
    return NextResponse.redirect(buildRedirect("/login?error=auth"));
  }

  const adminSupabase = createServiceRoleClient();
  const userId = data.user.id;

  // Store Google OAuth tokens if present
  const providerToken = data.session?.provider_token ?? null;
  const providerRefreshToken = data.session?.provider_refresh_token ?? null;
  console.log("[callback] step=tokens", {
    hasAccessToken: !!providerToken,
    hasRefreshToken: !!providerRefreshToken,
  });

  if (providerToken || providerRefreshToken) {
    const tokenExpiry = providerToken
      ? new Date(Date.now() + 3600 * 1000).toISOString()
      : null;
    const { error: tokenUpdateErr } = await adminSupabase
      .from("users")
      .update({
        ...(providerToken ? { google_access_token: providerToken } : {}),
        ...(providerRefreshToken ? { google_refresh_token: providerRefreshToken } : {}),
        ...(tokenExpiry ? { google_token_expires_at: tokenExpiry } : {}),
      })
      .eq("id", userId);
    if (tokenUpdateErr) {
      console.error("[callback] token update error (non-fatal — migration 003 may not be applied):", {
        message: tokenUpdateErr.message,
        code: tokenUpdateErr.code,
        details: tokenUpdateErr.details,
        hint: tokenUpdateErr.hint,
      });
    } else {
      console.log("[callback] step=token_update_ok");
    }
  }

  console.log("[callback] step=check_existing_user");
  const { data: existingUser, error: existingErr } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (existingErr) {
    console.error("[callback] FAIL: existing user check errored", {
      message: existingErr.message,
      code: existingErr.code,
      details: existingErr.details,
      hint: existingErr.hint,
    });
  }
  console.log("[callback] step=existing_user_done", {
    found: !!existingUser,
    errorMessage: existingErr?.message ?? "(none)",
  });

  if (!existingUser) {
    const isAdmin = data.user.email === process.env.ADMIN_EMAIL;
    console.log("[callback] step=new_user", {
      isAdmin,
      userEmail: data.user.email,
      adminEmail: process.env.ADMIN_EMAIL ? "(set)" : "(missing)",
      hasInviteToken: !!inviteToken,
    });

    if (!isAdmin) {
      if (!inviteToken) {
        console.log("[callback] step=redirect_unauthorized (no invite token)");
        return NextResponse.redirect(buildRedirect("/join?error=unauthorized"));
      }

      const { data: tokenRow, error: tokenErr } = await adminSupabase
        .from("invite_tokens")
        .select("id, used, expires_at")
        .eq("token", inviteToken)
        .maybeSingle();

      if (tokenErr) {
        console.error("[callback] invite token lookup error:", {
          message: tokenErr.message,
          code: tokenErr.code,
        });
      }
      console.log("[callback] step=invite_validated", {
        found: !!tokenRow,
        used: tokenRow?.used ?? "(not found)",
        expired: tokenRow ? new Date(tokenRow.expires_at as string) < new Date() : "(not found)",
        errorMessage: tokenErr?.message ?? "(none)",
      });

      if (!tokenRow || tokenRow.used || new Date(tokenRow.expires_at as string) < new Date()) {
        console.log("[callback] step=redirect_invalid_token");
        return NextResponse.redirect(buildRedirect("/join?error=invalid_token"));
      }

      const { error: markUsedErr } = await adminSupabase
        .from("invite_tokens")
        .update({ used: true })
        .eq("id", tokenRow.id);
      if (markUsedErr) {
        console.error("[callback] failed to mark invite token used:", {
          message: markUsedErr.message,
          code: markUsedErr.code,
        });
      }
    }

    let colorHex: string;
    if (isAdmin) {
      colorHex = "#33B679";
    } else {
      const MEMBER_COLORS = ["#9E69AF", "#0B8043", "#C0CA33"];
      const OVERFLOW_COLORS = ["#4285F4", "#F4511E", "#E67C73"];
      const { count: memberCount } = await adminSupabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("role", "member");
      const idx = memberCount ?? 0;
      colorHex = idx < MEMBER_COLORS.length
        ? MEMBER_COLORS[idx]
        : OVERFLOW_COLORS[(idx - MEMBER_COLORS.length) % OVERFLOW_COLORS.length];
    }

    console.log("[callback] step=insert_user");
    // Use service role for the insert: auth is already verified (OAuth + invite
    // token). The anon client's session can be unavailable during this callback
    // in certain SSR cookie-propagation edge cases, causing silent insert failure.
    const { error: insertErr } = await adminSupabase.from("users").insert({
      id: userId,
      email: data.user.email!,
      name: (data.user.user_metadata.full_name as string) ?? data.user.email!,
      avatar_url: (data.user.user_metadata.avatar_url as string) ?? null,
      role: isAdmin ? "admin" : "member",
      color_hex: colorHex,
    });

    if (insertErr) {
      console.error("[callback] FAIL: user insert failed", {
        message: insertErr.message,
        code: insertErr.code,
        details: insertErr.details,
        hint: insertErr.hint,
      });
    } else {
      console.log("[callback] step=insert_user_ok role=%s", isAdmin ? "admin" : "member");
    }

    if (isAdmin) {
      try {
        const { count, error: countErr } = await adminSupabase
          .from("memory")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);

        if (countErr) {
          console.error("[callback] memory count error:", { message: countErr.message });
        }

        if (count === 0) {
          const { error: seedErr } = await adminSupabase.from("memory").insert(
            CORE_MEMORIES.map((m) => ({
              user_id: userId,
              content: m.content,
              tier: "core",
              relevance_score: 1.0,
              category: m.category,
            }))
          );
          if (seedErr) {
            console.error("[callback] memory seed error:", { message: seedErr.message, code: seedErr.code });
          } else {
            console.log("[callback] step=memory_seeded count=%d", CORE_MEMORIES.length);
          }
        }
      } catch (seedErr) {
        console.error("[callback] memory seeding threw unexpectedly:", {
          message: seedErr instanceof Error ? seedErr.message : String(seedErr),
          stack: seedErr instanceof Error ? seedErr.stack : undefined,
        });
      }
    }
  }

  if (providerRefreshToken) {
    ensureBruceFolders(userId).catch((err) => {
      console.error("[callback] Drive folder setup failed (non-fatal):", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });
  }

  console.log("[callback] step=redirect_home success");
  return NextResponse.redirect(buildRedirect("/"));
}
