/**
 * Adds Nana to the CPS — Operations project as a member.
 * Run after Nana has accepted her invite and logged in for the first time.
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   npm run seed:cps:nana -- nana@example.com
 *
 * Prerequisites:
 *   - seed:cps must have been run first
 *   - Nana must have accepted her invite and logged into Bruce
 *   - .env.local must be present with NEXT_PUBLIC_SUPABASE_URL and
 *     SUPABASE_SERVICE_ROLE_KEY
 */

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
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env.local absent — fall through to actual environment variables
  }
}

loadEnv();

const nanaEmail = process.argv[2];
if (!nanaEmail || !nanaEmail.includes("@")) {
  console.error(
    "Usage: npm run seed:cps:nana -- <nana@email.com>\n" +
      "Example: npm run seed:cps:nana -- nana@gmail.com"
  );
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing required env vars. Check .env.local for:\n" +
      "  NEXT_PUBLIC_SUPABASE_URL\n" +
      "  SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. Look up Nana's user row by email
  const { data: nana, error: userErr } = await supabase
    .from("users")
    .select("id, name")
    .eq("email", nanaEmail)
    .maybeSingle();

  if (userErr) {
    console.error("Error looking up user:", userErr.message);
    process.exit(1);
  }
  if (!nana) {
    console.error(
      `No user found with email ${nanaEmail}.\n` +
        "Nana must accept her invite and log into Bruce first."
    );
    process.exit(1);
  }

  console.log(`Found user: ${nana.name} (${nana.id})`);

  // 2. Find the CPS project
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, name")
    .eq("name", "CPS — Operations")
    .maybeSingle();

  if (projectErr) {
    console.error("Error looking up project:", projectErr.message);
    process.exit(1);
  }
  if (!project) {
    console.error(
      "CPS — Operations project not found.\n" + "Run npm run seed:cps first."
    );
    process.exit(1);
  }

  // 3. Idempotency check
  const { data: existing } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", project.id)
    .eq("user_id", nana.id)
    .maybeSingle();

  if (existing) {
    console.log(`${nana.name} is already a member of CPS — Operations.`);
    process.exit(0);
  }

  // 4. Add Nana as member
  const { error: memberErr } = await supabase.from("project_members").insert({
    project_id: project.id,
    user_id: nana.id,
    role: "member",
  });

  if (memberErr) {
    console.error("Failed to add member:", memberErr.message);
    process.exit(1);
  }

  console.log(`✓ ${nana.name} added to CPS — Operations as member`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
