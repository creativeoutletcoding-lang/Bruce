/**
 * One-time seed: creates the CPS — Operations project and adds Jake as owner.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npm run seed:cps
 *
 * Prerequisites:
 *   - Jake must have logged into Bruce at least once (so his users row exists)
 *   - .env.local must be present with NEXT_PUBLIC_SUPABASE_URL,
 *     SUPABASE_SERVICE_ROLE_KEY, and ADMIN_EMAIL
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local so the script works without manually setting env vars
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
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env.local absent — fall through to actual environment variables
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.ADMIN_EMAIL;

if (!supabaseUrl || !serviceRoleKey || !adminEmail) {
  console.error(
    "Missing required env vars. Check .env.local for:\n" +
      "  NEXT_PUBLIC_SUPABASE_URL\n" +
      "  SUPABASE_SERVICE_ROLE_KEY\n" +
      "  ADMIN_EMAIL"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Look up Jake's user row by admin email
  const { data: jake, error: userErr } = await supabase
    .from("users")
    .select("id, name")
    .eq("email", adminEmail)
    .maybeSingle();

  if (userErr) {
    console.error("Error looking up user:", userErr.message);
    process.exit(1);
  }
  if (!jake) {
    console.error(
      `No user found with email ${adminEmail}.\n` +
        "Jake must log into Bruce at least once before running this seed."
    );
    process.exit(1);
  }

  console.log(`Found user: ${jake.name} (${jake.id})`);

  // 2. Idempotency check
  const { data: existing } = await supabase
    .from("projects")
    .select("id, name")
    .eq("name", "CPS — Operations")
    .eq("owner_id", jake.id)
    .maybeSingle();

  if (existing) {
    console.log(`Already exists: CPS — Operations (id: ${existing.id})`);
    process.exit(0);
  }

  // 3. Create the project
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .insert({
      owner_id: jake.id,
      name: "CPS — Operations",
      icon: "🐾",
      instructions:
        "Business workspace for Capital Petsitters. Be concise and practical. " +
        "Nana prefers clear simple explanations. " +
        "Always recalculate WC at 3% from scratch before any payment action.",
    })
    .select("id")
    .single();

  if (projectErr || !project) {
    console.error("Failed to create project:", projectErr?.message);
    process.exit(1);
  }

  // 4. Add Jake as owner member
  const { error: memberErr } = await supabase.from("project_members").insert({
    project_id: project.id,
    user_id: jake.id,
    role: "owner",
  });

  if (memberErr) {
    console.error("Failed to add Jake as project owner:", memberErr.message);
    // Roll back — delete the project we just created
    await supabase.from("projects").delete().eq("id", project.id);
    process.exit(1);
  }

  console.log(`✓ Created: CPS — Operations (id: ${project.id})`);
  console.log(`✓ ${jake.name} added as owner`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
