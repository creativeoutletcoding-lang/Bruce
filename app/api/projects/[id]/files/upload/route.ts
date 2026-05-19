import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { uploadRawFileToProject } from "@/lib/google/drive";
import type { File as BruceFile } from "@/lib/types";

export const runtime = "nodejs";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .single();

  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const name = file.name;

  let driveFileId: string;
  try {
    driveFileId = await uploadRawFileToProject(user.id, id, buffer, name, mimeType);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const driveUrl = `https://drive.google.com/file/d/${driveFileId}`;

  const { data: dbFile, error } = await supabase
    .from("files")
    .insert({
      project_id: id,
      owner_id: user.id,
      google_drive_file_id: driveFileId,
      name,
      mime_type: mimeType,
      drive_url: driveUrl,
      last_updated: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(dbFile as BruceFile, { status: 201 });
}
