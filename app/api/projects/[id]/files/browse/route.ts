import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { listProjectFiles } from "@/lib/google/drive";
import type { DriveFile } from "@/lib/types";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify project membership via RLS
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const files: DriveFile[] = await listProjectFiles(user.id, id);
    return NextResponse.json(files);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Drive error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
