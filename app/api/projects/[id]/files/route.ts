import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { ensureProjectFolder } from "@/lib/google/drive";
import type { File as BruceFile } from "@/lib/types";

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

  // RLS ensures user is a project member
  const { data: files, error } = await supabase
    .from("files")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((files ?? []) as BruceFile[]);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    google_drive_file_id: string;
    name: string;
    mime_type?: string;
    drive_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.google_drive_file_id || !body.name) {
    return NextResponse.json(
      { error: "google_drive_file_id and name required" },
      { status: 400 }
    );
  }

  // Ensure the project's Drive folder exists (creates it if needed)
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", id)
      .single();
    if (project) {
      ensureProjectFolder(user.id, project.name as string).catch((err) => {
        console.error("[files/route] ensureProjectFolder failed:", err);
      });
    }
  } catch {
    // Non-fatal — folder creation will retry on next Drive interaction
  }

  const { data: file, error } = await supabase
    .from("files")
    .insert({
      project_id: id,
      owner_id: user.id,
      google_drive_file_id: body.google_drive_file_id,
      name: body.name,
      mime_type: body.mime_type ?? null,
      drive_url: body.drive_url ?? null,
      last_updated: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(file as BruceFile, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { file_id: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.file_id) {
    return NextResponse.json({ error: "file_id required" }, { status: 400 });
  }

  // Verify file exists and check permissions: project owner or file owner
  const { data: fileRecord } = await supabase
    .from("files")
    .select("id, owner_id, project_id")
    .eq("id", body.file_id)
    .eq("project_id", id)
    .single();

  if (!fileRecord) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Check if user is file owner or project owner
  const isFileOwner = fileRecord.owner_id === user.id;
  if (!isFileOwner) {
    const { data: projectMember } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", id)
      .eq("user_id", user.id)
      .single();

    if (projectMember?.role !== "owner") {
      const { data: userProfile } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();
      if (userProfile?.role !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const { error } = await supabase
    .from("files")
    .delete()
    .eq("id", body.file_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
