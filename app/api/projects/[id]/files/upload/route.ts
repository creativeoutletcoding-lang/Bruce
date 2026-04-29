import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/google/drive";
import type { File as BruceFile } from "@/lib/types";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

const MIME_MAP: Record<string, string> = {
  doc: "application/vnd.google-apps.document",
  sheet: "application/vnd.google-apps.spreadsheet",
  note: "text/plain",
};

const DRIVE_URL_BASE = "https://docs.google.com";
const DRIVE_URL_MAP: Record<string, string> = {
  doc: `${DRIVE_URL_BASE}/document/d/`,
  sheet: `${DRIVE_URL_BASE}/spreadsheets/d/`,
  note: "https://drive.google.com/file/d/",
};

export async function POST(request: NextRequest, { params }: Props) {
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

  let body: { name: string; content: string; type: "doc" | "sheet" | "note" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!body.type || !MIME_MAP[body.type]) {
    return NextResponse.json({ error: "type must be doc, sheet, or note" }, { status: 400 });
  }

  const mimeType = MIME_MAP[body.type];

  let driveFileId: string;
  try {
    driveFileId = await uploadFile(
      user.id,
      id,
      body.name.trim(),
      body.content ?? "",
      mimeType
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const driveUrl = `${DRIVE_URL_MAP[body.type]}${driveFileId}`;

  const { data: file, error } = await supabase
    .from("files")
    .insert({
      project_id: id,
      owner_id: user.id,
      google_drive_file_id: driveFileId,
      name: body.name.trim(),
      mime_type: mimeType,
      drive_url: driveUrl,
      last_updated: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(file as BruceFile, { status: 201 });
}
