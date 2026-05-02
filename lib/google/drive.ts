// ============================================================
// Bruce — Google Drive client
// All Drive operations are server-side only.
// Uses drive.file scope — Bruce only touches files he created/opened.
// Folder structure: Bruce/ → Bruce/Personal/, Bruce/Projects/[name]/
// ============================================================

import { createServiceRoleClient } from "@/lib/supabase/server";
import type { BruceFolderIds, DriveFile } from "@/lib/types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// Token management
// ============================================================

async function getValidToken(userId: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from("users")
    .select("google_access_token, google_refresh_token, google_token_expires_at")
    .eq("id", userId)
    .single();

  if (!user?.google_refresh_token) {
    throw new Error(
      "Google Drive authorization required. Please reconnect your Google account."
    );
  }

  const expiresAt = user.google_token_expires_at
    ? new Date(user.google_token_expires_at)
    : null;
  const now = Date.now();

  if (
    user.google_access_token &&
    expiresAt &&
    expiresAt.getTime() - now > REFRESH_BUFFER_MS
  ) {
    return user.google_access_token;
  }

  // Refresh the token
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: user.google_refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(
      "Google Drive authorization expired. Please reconnect your Google account."
    );
  }

  const tokenData = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  const newExpiresAt = new Date(now + tokenData.expires_in * 1000).toISOString();

  await supabase
    .from("users")
    .update({
      google_access_token: tokenData.access_token,
      google_token_expires_at: newExpiresAt,
    })
    .eq("id", userId);

  return tokenData.access_token;
}

// ============================================================
// Low-level Drive API helpers
// ============================================================

async function driveGet(
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${DRIVE_API}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive API GET ${path} failed: ${res.status} — ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function drivePost(
  token: string,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive API POST ${path} failed: ${res.status} — ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ============================================================
// Folder helpers
// ============================================================

async function findFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string | null> {
  const parentClause =
    parentId === "root" ? `'root' in parents` : `'${parentId}' in parents`;
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and ${parentClause} and trashed=false`;
  const data = await driveGet(token, "/files", {
    q,
    fields: "files(id)",
    pageSize: "1",
  });
  const files = data.files as Array<{ id: string }>;
  return files.length > 0 ? files[0].id : null;
}

async function createFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const parents = parentId === "root" ? ["root"] : [parentId];
  const data = await drivePost(token, "/files", {
    name,
    mimeType: FOLDER_MIME,
    parents,
  });
  return data.id as string;
}

async function ensureFolder(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const existing = await findFolder(token, name, parentId);
  if (existing) return existing;
  return createFolder(token, name, parentId);
}

// ============================================================
// Public API
// ============================================================

export async function ensureBruceFolders(userId: string): Promise<BruceFolderIds> {
  const token = await getValidToken(userId);
  const supabase = createServiceRoleClient();

  // Check cached folder IDs
  const { data: user } = await supabase
    .from("users")
    .select("google_drive_root_id, google_drive_personal_id, google_drive_projects_id")
    .eq("id", userId)
    .single();

  if (
    user?.google_drive_root_id &&
    user?.google_drive_personal_id &&
    user?.google_drive_projects_id
  ) {
    return {
      rootId: user.google_drive_root_id,
      personalId: user.google_drive_personal_id,
      projectsId: user.google_drive_projects_id,
    };
  }

  // Create/verify the folder tree
  const rootId = await ensureFolder(token, "Bruce", "root");
  const personalId = await ensureFolder(token, "Personal", rootId);
  const projectsId = await ensureFolder(token, "Projects", rootId);

  // Cache in DB
  await supabase
    .from("users")
    .update({
      google_drive_root_id: rootId,
      google_drive_personal_id: personalId,
      google_drive_projects_id: projectsId,
    })
    .eq("id", userId);

  return { rootId, personalId, projectsId };
}

export async function ensureProjectFolder(
  userId: string,
  projectName: string
): Promise<string> {
  const token = await getValidToken(userId);
  const { projectsId } = await ensureBruceFolders(userId);
  return ensureFolder(token, projectName, projectsId);
}

export async function listProjectFiles(
  userId: string,
  projectId: string
): Promise<DriveFile[]> {
  const token = await getValidToken(userId);

  // Look up project name
  const supabase = createServiceRoleClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  if (!project) return [];

  const folderId = await ensureProjectFolder(userId, project.name as string);

  const data = await driveGet(token, "/files", {
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });

  const files = data.files as Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink: string;
    modifiedTime: string;
  }>;

  return files.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    webViewLink: f.webViewLink ?? "",
    modifiedTime: f.modifiedTime,
  }));
}

export async function getFileContent(
  userId: string,
  fileId: string
): Promise<string> {
  const token = await getValidToken(userId);

  // Get file metadata
  const meta = await driveGet(token, `/files/${fileId}`, {
    fields: "id,name,mimeType",
  });
  const mimeType = meta.mimeType as string;

  const MAX_CHARS = 2000;

  async function fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return "";
    const text = await res.text();
    if (text.length > MAX_CHARS) return text.substring(0, MAX_CHARS) + "... [truncated]";
    return text;
  }

  if (mimeType === "application/vnd.google-apps.document") {
    return fetchText(`${DRIVE_API}/files/${fileId}/export?mimeType=text%2Fplain`);
  }
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return fetchText(`${DRIVE_API}/files/${fileId}/export?mimeType=text%2Fcsv`);
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return fetchText(`${DRIVE_API}/files/${fileId}/export?mimeType=text%2Fplain`);
  }
  if (mimeType.startsWith("text/")) {
    return fetchText(`${DRIVE_API}/files/${fileId}?alt=media`);
  }

  console.warn(`[drive] getFileContent: unsupported mimeType ${mimeType} for file ${fileId}`);
  return "";
}

export async function uploadImageToPersonalFolder(
  userId: string,
  imageBuffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  const token = await getValidToken(userId);
  const { personalId } = await ensureBruceFolders(userId);

  const boundary = `bruce_img_${Date.now()}`;
  const metadataJson = JSON.stringify({ name: filename, parents: [personalId], mimeType });

  const headerPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const footerPart = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([headerPart, imageBuffer, footerPart]);

  const uploadRes = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Drive image upload failed: ${uploadRes.status} — ${err}`);
  }

  const { id: fileId } = await uploadRes.json() as { id: string };

  // Make publicly readable so it can serve as an <img> src
  await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

export async function uploadFile(
  userId: string,
  projectId: string,
  name: string,
  content: string,
  mimeType: string
): Promise<string> {
  const token = await getValidToken(userId);

  // Look up project name to find/create the folder
  const supabase = createServiceRoleClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  if (!project) throw new Error("Project not found");

  const folderId = await ensureProjectFolder(userId, project.name as string);

  // Determine source content type for multipart upload
  let sourceContentType = "text/plain";
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    sourceContentType = "text/csv";
  }

  const boundary = `bruce_upload_${Date.now()}`;
  const metadata = JSON.stringify({ name, mimeType, parents: [folderId] });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${sourceContentType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive upload failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}
