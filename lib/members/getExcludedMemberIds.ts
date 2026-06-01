import { createServiceRoleClient } from "@/lib/supabase/server";

export async function getExcludedMemberIds(userId: string): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("member_exclusions")
    .select("user_id_a, user_id_b")
    .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`);

  if (error || !data) return [];

  return data.map((row) =>
    row.user_id_a === userId ? row.user_id_b : row.user_id_a
  );
}
