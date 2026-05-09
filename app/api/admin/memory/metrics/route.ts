import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface MemoryMetricRow {
  user_id: string;
  name: string;
  private_core_count: number;
  private_active_count: number;
  private_archive_count: number;
  shared_count: number;
  total_count: number;
}

export async function GET() {
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
  const { data, error } = await admin.rpc("get_memory_metrics");

  if (error) {
    console.error("[api/admin/memory/metrics] RPC error:", error);
    return NextResponse.json({ error: "Failed to load metrics" }, { status: 500 });
  }

  return NextResponse.json({ metrics: data as MemoryMetricRow[], current_user_id: user.id });
}
