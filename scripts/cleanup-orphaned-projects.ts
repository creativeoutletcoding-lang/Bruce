/**
 * One-time cleanup: deletes projects that have no project_members rows.
 * These are orphaned rows created when project creation partially failed
 * (project row inserted but the subsequent project_members insert was
 * blocked by RLS for non-admin users).
 *
 * Usage:
 *   npm run cleanup:orphaned-projects
 *
 * Prerequisites:
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
    console.warn("Could not load .env.local — relying on existing env vars");
  }
}

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);

  // Find projects with no project_members row
  const { data: allProjects, error: listErr } = await supabase
    .from("projects")
    .select("id, name, owner_id, created_at");

  if (listErr) {
    console.error("Failed to list projects:", listErr.message);
    process.exit(1);
  }

  if (!allProjects?.length) {
    console.log("No projects found.");
    return;
  }

  const { data: allMembers, error: membersErr } = await supabase
    .from("project_members")
    .select("project_id");

  if (membersErr) {
    console.error("Failed to list project_members:", membersErr.message);
    process.exit(1);
  }

  const memberProjectIds = new Set((allMembers ?? []).map((m: { project_id: string }) => m.project_id));

  const orphaned = allProjects.filter((p: { id: string }) => !memberProjectIds.has(p.id));

  if (orphaned.length === 0) {
    console.log(`Checked ${allProjects.length} project(s) — no orphans found.`);
    return;
  }

  console.log(`Found ${orphaned.length} orphaned project(s):`);
  for (const p of orphaned) {
    console.log(`  - ${p.name} (id=${p.id}, owner=${p.owner_id}, created=${p.created_at})`);
  }

  const orphanIds = orphaned.map((p: { id: string }) => p.id);

  const { error: deleteErr } = await supabase
    .from("projects")
    .delete()
    .in("id", orphanIds);

  if (deleteErr) {
    console.error("Delete failed:", deleteErr.message);
    process.exit(1);
  }

  console.log(`Deleted ${orphaned.length} orphaned project(s).`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
