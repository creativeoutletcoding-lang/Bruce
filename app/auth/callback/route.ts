import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocalEnv = process.env.NODE_ENV === "development";

  function buildRedirect(path: string) {
    if (isLocalEnv) return `${requestUrl.origin}${path}`;
    if (forwardedHost) return `https://${forwardedHost}${path}`;
    return `${requestUrl.origin}${path}`;
  }

  if (!code) {
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

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(buildRedirect("/login?error=auth"));
  }

  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!existingUser) {
    const isAdmin = data.user.email === process.env.ADMIN_EMAIL;
    await supabase.from("users").insert({
      id: data.user.id,
      email: data.user.email!,
      name:
        (data.user.user_metadata.full_name as string) ?? data.user.email!,
      avatar_url:
        (data.user.user_metadata.avatar_url as string) ?? null,
      role: isAdmin ? "admin" : "member",
    });

    // Seed core memories for new user
    try {
      const adminSupabase = createServiceRoleClient();
      const { count } = await adminSupabase
        .from("memory")
        .select("id", { count: "exact", head: true })
        .eq("user_id", data.user.id);

      if (count === 0) {
        await adminSupabase.from("memory").insert(
          CORE_MEMORIES.map((m) => ({
            user_id: data.user.id,
            content: m.content,
            tier: "core",
            relevance_score: 1.0,
            category: m.category,
          }))
        );
      }
    } catch (seedErr) {
      console.error("[auth/callback] Memory seeding failed:", seedErr);
    }
  }

  return NextResponse.redirect(buildRedirect("/"));
}
