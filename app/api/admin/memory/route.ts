import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const userId = new URL(request.url).searchParams.get("user_id");

  if (userId) {
    // Return full memory list for a specific user
    const { data: memories, error } = await admin
      .from("memory")
      .select("id, content, tier, relevance_score, category, last_accessed, created_at, updated_at")
      .eq("user_id", userId)
      .order("tier")
      .order("relevance_score", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Failed to fetch memories" }, { status: 500 });
    }

    return NextResponse.json(memories ?? []);
  }

  // Return summary per member
  const { data: users } = await admin
    .from("users")
    .select("id, name, color_hex")
    .eq("status", "active")
    .order("name");

  const summaries = await Promise.all(
    (users ?? []).map(async (u) => {
      const { data: memories } = await admin
        .from("memory")
        .select("id, tier, category")
        .eq("user_id", u.id);

      const tiers = { core: 0, active: 0, archive: 0 };
      const categorySet = new Set<string>();

      for (const m of memories ?? []) {
        if (m.tier === "core") tiers.core++;
        else if (m.tier === "active") tiers.active++;
        else if (m.tier === "archive") tiers.archive++;
        if (m.category) categorySet.add(m.category);
      }

      return {
        user_id: u.id,
        name: u.name,
        color_hex: u.color_hex,
        core_count: tiers.core,
        active_count: tiers.active,
        archive_count: tiers.archive,
        total_count: (memories ?? []).length,
        categories: Array.from(categorySet),
      };
    })
  );

  return NextResponse.json(summaries);
}
