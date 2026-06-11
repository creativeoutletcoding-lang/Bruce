// Audit trail for every project-instructions write — added after a production
// incident where the automatic instructions updater silently rewrote and
// truncated the CPS project instructions (max_tokens cut the model's full
// rewrite mid-list and the route overwrote the row with it). Every write is
// now logged with before/after lengths so any future truncation is traceable
// to its source.
//
// Storage: system_config key "instructions_audit_log" (TEXT value holding a
// JSON array, newest last, capped). No migration needed — the table exists.

import { createServiceRoleClient } from "@/lib/supabase/server";

const AUDIT_KEY = "instructions_audit_log";
const AUDIT_MAX_ENTRIES = 100;

export interface InstructionsAuditEntry {
  ts: string;
  projectId: string;
  /** Chat that triggered the write, when applicable. */
  chatId: string | null;
  /** "auto" = the unmount-triggered model updater; "manual" = user edit via project panel. */
  source: "auto" | "manual";
  oldLength: number;
  newLength: number;
}

export async function logInstructionsWrite(entry: Omit<InstructionsAuditEntry, "ts">): Promise<void> {
  const full: InstructionsAuditEntry = { ts: new Date().toISOString(), ...entry };
  // Always visible in Vercel logs even if the DB write fails.
  console.error(
    `[instructions-audit] project=${full.projectId} source=${full.source} chat=${full.chatId ?? "-"} oldLen=${full.oldLength} newLen=${full.newLength}`
  );
  try {
    const admin = createServiceRoleClient();
    const { data } = await admin
      .from("system_config")
      .select("value")
      .eq("key", AUDIT_KEY)
      .maybeSingle();
    let entries: InstructionsAuditEntry[] = [];
    if (data?.value) {
      try {
        const parsed = JSON.parse(data.value as string);
        if (Array.isArray(parsed)) entries = parsed as InstructionsAuditEntry[];
      } catch { /* corrupt log — start fresh */ }
    }
    entries.push(full);
    if (entries.length > AUDIT_MAX_ENTRIES) entries = entries.slice(-AUDIT_MAX_ENTRIES);
    await admin
      .from("system_config")
      .upsert({ key: AUDIT_KEY, value: JSON.stringify(entries), updated_at: new Date().toISOString() });
  } catch (err) {
    console.error("[instructions-audit] failed to persist audit entry:", err);
  }
}
