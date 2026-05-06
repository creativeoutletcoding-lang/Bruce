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

  const [messagesThisMonth, allUsers, filesThisMonth, imagesThisMonth, searchesThisMonth] =
    await Promise.all([
      admin
        .from("messages")
        .select("sender_id", { count: "exact" })
        .gte("created_at", monthStart)
        .eq("role", "user"),
      admin.from("users").select("id, name, color_hex").eq("status", "active"),
      admin
        .from("files")
        .select("id", { count: "exact" })
        .gte("created_at", monthStart),
      admin
        .from("messages")
        .select("id", { count: "exact" })
        .gte("created_at", monthStart)
        .eq("metadata->>content_type", "image"),
      admin
        .from("messages")
        .select("id", { count: "exact" })
        .gte("created_at", monthStart)
        .eq("metadata->>web_search_used", "true"),
    ]);

  const totalMessages = messagesThisMonth.count ?? 0;
  const totalImages = imagesThisMonth.count ?? 0;
  const totalSearches = searchesThisMonth.count ?? 0;

  const memberCounts: Record<string, number> = {};
  for (const msg of messagesThisMonth.data ?? []) {
    if (msg.sender_id) {
      memberCounts[msg.sender_id] = (memberCounts[msg.sender_id] ?? 0) + 1;
    }
  }

  const users = allUsers.data ?? [];
  const byMember = users
    .map((u) => ({
      user_id: u.id,
      name: u.name,
      color_hex: u.color_hex ?? "#0F6E56",
      count: memberCounts[u.id] ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Cost estimation
  // Anthropic claude-sonnet-4-6: ~$3/M input + $15/M output, ~1600 tokens/exchange → ~$0.012/message
  const chatApiCost = parseFloat((totalMessages * 0.012).toFixed(2));
  // Replicate flux-schnell: $0.003/image
  const replicateCost = parseFloat((totalImages * 0.003).toFixed(2));
  // Perplexity sonar-pro: ~$0.005/request
  const perplexityCost = parseFloat((totalSearches * 0.005).toFixed(2));
  const totalCost = parseFloat((chatApiCost + replicateCost + perplexityCost).toFixed(2));

  return NextResponse.json({
    period,
    messages_total: totalMessages,
    messages_by_member: byMember,
    files_attached: filesThisMonth.count ?? 0,
    images_generated: totalImages,
    web_searches: totalSearches,
    cost_breakdown: {
      chat_api: chatApiCost,
      replicate: replicateCost,
      perplexity: perplexityCost,
      total: totalCost,
    },
  });
}
