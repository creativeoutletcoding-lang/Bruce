import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* .env.local absent */ }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data, error } = await supabase
    .from("chats")
    .select("id, owner_id, type, title, created_at")
    .eq("type", "family_group")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Query error:", error);
    process.exit(1);
  }

  console.log(`\nfamily_group rows (${(data ?? []).length} found):\n`);
  if (!data || data.length === 0) {
    console.log("  (none)");
  } else {
    for (const row of data) {
      console.log(JSON.stringify(row, null, 2));
    }
  }

  // Also show chat_members for any found chats
  if (data && data.length > 0) {
    const chatIds = data.map((r: { id: string }) => r.id);
    const { data: members, error: membErr } = await supabase
      .from("chat_members")
      .select("chat_id, user_id, joined_at")
      .in("chat_id", chatIds);

    if (membErr) {
      console.error("Members query error:", membErr);
    } else {
      console.log(`\nchat_members for those chats (${(members ?? []).length} rows):\n`);
      for (const m of members ?? []) {
        console.log(JSON.stringify(m, null, 2));
      }
    }
  }
}

main().catch(console.error);
