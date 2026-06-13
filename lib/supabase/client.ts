import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // PKCE is required for the native deep-link code exchange. @supabase/ssr
      // already defaults to "pkce" for both browser and server clients, so this
      // is an explicit no-op restatement — not a behavior change for web.
      auth: { flowType: "pkce" },
    }
  );
}
