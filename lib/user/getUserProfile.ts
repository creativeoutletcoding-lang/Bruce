import type { SupabaseClient } from "@supabase/supabase-js";

// Single source of truth for user profile data.
// Add new users columns here — all chat contexts will get them.

export interface UserProfile {
  id: string;
  name: string;
  color_hex: string;
  email: string;
  preferred_model: string | null;
  preferred_effort: string | null;
}

export async function getUserProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<UserProfile | null> {
  const { data } = await supabase
    .from("users")
    .select("id, name, color_hex, email, preferred_model, preferred_effort")
    .eq("id", userId)
    .single();
  return data as UserProfile | null;
}
