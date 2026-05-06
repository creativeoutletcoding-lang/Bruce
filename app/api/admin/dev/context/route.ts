import { createClient } from "@/lib/supabase/server";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

interface PhaseEntry {
  number: string;
  name: string;
  status: "complete" | "active" | "queued";
}

interface StackEntry {
  layer: string;
  technology: string;
}

function parseClaudeMd(content: string): { phases: PhaseEntry[]; stack: StackEntry[] } {
  const lines = content.split("\n");
  const phases: PhaseEntry[] = [];
  const stack: StackEntry[] = [];

  let inPhases = false;
  let inStack = false;

  for (const line of lines) {
    if (line.startsWith("## Build Phases")) {
      inPhases = true;
      inStack = false;
      continue;
    }
    if (line.startsWith("## Tech Stack")) {
      inStack = true;
      inPhases = false;
      continue;
    }
    if (line.startsWith("## ")) {
      inPhases = false;
      inStack = false;
      continue;
    }

    if (!line.startsWith("|")) continue;
    // Skip separator rows like |---|---|
    if (/^\|[-:\s|]+\|$/.test(line)) continue;

    const cells = line.split("|").map((s) => s.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    if (inPhases) {
      if (cells[0].toLowerCase() === "phase") continue; // header row

      const match = cells[0].match(/^(\d+)\s*[—–-]\s*(.+)$/);
      if (!match) continue;

      const statusCell = cells[1];
      let status: PhaseEntry["status"] = "queued";
      if (statusCell.includes("✅")) {
        status = "complete";
      } else if (statusCell.includes("🔄") || /in.?progress/i.test(statusCell)) {
        status = "active";
      }

      phases.push({ number: match[1], name: match[2].trim(), status });
    }

    if (inStack) {
      if (cells[0].toLowerCase() === "layer") continue; // header row
      stack.push({ layer: cells[0], technology: cells[1] });
    }
  }

  return { phases, stack };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

  let content: string;
  try {
    content = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf-8");
  } catch {
    return new Response("CLAUDE.md not found", { status: 500 });
  }

  const { phases, stack } = parseClaudeMd(content);
  return Response.json({ phases, stack });
}
