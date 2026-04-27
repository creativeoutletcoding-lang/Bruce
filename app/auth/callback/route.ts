import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
  }

  return NextResponse.redirect(buildRedirect("/"));
}
