import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [messagesThisMonth, allUsers, filesThisMonth] = await Promise.all([
    admin
      .from("messages")
      .select("sender_id", { count: "exact" })
      .gte("created_at", monthStart)
      .eq("role", "user"),
    admin.from("users").select("id, name, avatar_url").eq("status", "active"),
    admin
      .from("files")
      .select("id", { count: "exact" })
      .gte("created_at", monthStart),
  ]);

  const totalMessages = messagesThisMonth.count ?? 0;

  // Message count per member this month
  const memberCounts: Record<string, number> = {};
  for (const msg of messagesThisMonth.data ?? []) {
    if (msg.sender_id) {
      memberCounts[msg.sender_id] = (memberCounts[msg.sender_id] ?? 0) + 1;
    }
  }

  const users = allUsers.data ?? [];
  const byMember = users.map((u) => ({
    user_id: u.id,
    name: u.name,
    avatar_url: u.avatar_url,
    count: memberCounts[u.id] ?? 0,
  }));

  // Cost estimation: claude-sonnet-4-6 ~ $3/M input, $15/M output
  // Approx per user message exchange: 1000 input tokens + 600 output tokens
  const estimatedApiCost = parseFloat((totalMessages * 0.012).toFixed(2));

  return NextResponse.json({
    period,
    messages_total: totalMessages,
    messages_by_member: byMember,
    files_attached: filesThisMonth.count ?? 0,
    estimated_api_cost_usd: estimatedApiCost,
    cost_breakdown: {
      chat_api: estimatedApiCost,
      hosting_note: "Vercel Pro ~$20/mo (subscription)",
      database_note: "Supabase Pro ~$25/mo (subscription)",
    },
  });
}
