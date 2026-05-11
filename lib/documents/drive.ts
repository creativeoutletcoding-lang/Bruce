// ============================================================
// Bruce — document-layer Drive operations
// Path-based wrappers scoped to Bruce/ folder structure only.
// Valid root paths: "Personal", "Projects", "Projects/<name>", "Shared"
// All functions are server-side only.
// ============================================================

import { getValidToken } from "@/lib/google/auth";
import { ensureBruceFolders } from "@/lib/google/drive";
import { createServiceRoleClient } from "@/lib/supabase/server";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// ── Types ────────────────────────────────────────────────────

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  size?: string;
}

export interface DriveListResult {
  folderPath: string;
  files: DriveFileEntry[];
}

// ── Low-level helpers ────────────────────────────────────────

async function driveGet(
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${DRIVE_API}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive GET ${path} failed: ${res.status} — ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function findFolderByName(
  token: string,
  name: string,
  parentId: string
): Promise<string | null> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`;
  const data = await driveGet(token, "/files", {
    q,
    fields: "files(id)",
    pageSize: "1",
  });
  const files = data.files as Array<{ id: string }>;
  return files.length > 0 ? files[0].id : null;
}

async function ensureFolderByName(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const existing = await findFolderByName(token, name, parentId);
  if (existing) return existing;

  const res = await fetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive create folder failed: ${res.status} — ${err}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

// ── Path resolution ──────────────────────────────────────────

// Resolves a Bruce-relative path like "Personal", "Projects/CPS", "Shared"
// to a Drive folder ID. Creates intermediate folders as needed.
// Only traverses within the Bruce root — cannot escape.
export async function resolveFolderPath(
  userId: string,
  folderPath: string
): Promise<string> {
  const token = await getValidToken(userId);
  const { rootId, personalId, projectsId } = await ensureBruceFolders(userId);

  const parts = folderPath.trim().replace(/^\/|\/$/g, "").split("/").filter(Boolean);
  if (parts.length === 0) return personalId;

  const [root, ...rest] = parts;
  const normalized = root.toLowerCase();

  let currentId: string;
  if (normalized === "personal") {
    currentId = personalId;
  } else if (normalized === "projects") {
    currentId = projectsId;
  } else if (normalized === "shared") {
    currentId = await ensureFolderByName(token, "Shared", rootId);
  } else {
    // Unknown root — treat as a subfolder of Personal for safety
    currentId = await ensureFolderByName(token, root, personalId);
  }

  // Traverse remaining path segments
  for (const segment of rest) {
    currentId = await ensureFolderByName(token, segment, currentId);
  }

  return currentId;
}

// ── Public API ───────────────────────────────────────────────

export async function listFiles(
  userId: string,
  folderPath = "Personal"
): Promise<DriveListResult> {
  const token = await getValidToken(userId);
  const folderId = await resolveFolderPath(userId, folderPath);

  const data = await driveGet(token, "/files", {
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
    orderBy: "modifiedTime desc",
    pageSize: "50",
  });

  const files = (data.files ?? []) as Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    modifiedTime: string;
    size?: string;
  }>;

  return {
    folderPath,
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink ?? "",
      modifiedTime: f.modifiedTime,
      size: f.size,
    })),
  };
}

export async function moveFile(
  userId: string,
  fileId: string,
  destinationPath: string
): Promise<void> {
  const token = await getValidToken(userId);
  const destFolderId = await resolveFolderPath(userId, destinationPath);

  // Get current parents
  const meta = await driveGet(token, `/files/${fileId}`, { fields: "parents" });
  const currentParents = ((meta.parents ?? []) as string[]).join(",");

  const url = new URL(`${DRIVE_API}/files/${fileId}`);
  url.searchParams.set("addParents", destFolderId);
  if (currentParents) url.searchParams.set("removeParents", currentParents);
  url.searchParams.set("fields", "id,name,parents");

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive move failed: ${res.status} — ${err}`);
  }
}

export async function exportAsPDF(
  userId: string,
  fileId: string,
  destinationPath?: string
): Promise<{ fileId: string; fileName: string; webViewLink: string }> {
  const token = await getValidToken(userId);

  // Get source file metadata
  const meta = await driveGet(token, `/files/${fileId}`, {
    fields: "id,name,mimeType,parents",
  });
  const sourceName = meta.name as string;
  const pdfName = sourceName.endsWith(".pdf") ? sourceName : `${sourceName}.pdf`;

  // Export as PDF bytes
  const exportRes = await fetch(
    `${DRIVE_API}/files/${fileId}/export?mimeType=application%2Fpdf`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!exportRes.ok) {
    const err = await exportRes.text();
    throw new Error(`PDF export failed: ${exportRes.status} — ${err}`);
  }
  const pdfBytes = await exportRes.arrayBuffer();

  // Determine destination folder
  const targetFolderId = destinationPath
    ? await resolveFolderPath(userId, destinationPath)
    : ((meta.parents as string[] | undefined)?.[0] ?? (await resolveFolderPath(userId, "Personal")));

  // Upload PDF to Drive
  const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
  const boundary = `bruce_pdf_${Date.now()}`;
  const metaJson = JSON.stringify({
    name: pdfName,
    mimeType: "application/pdf",
    parents: [targetFolderId],
  });
  const headerPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    "utf8"
  );
  const footerPart = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const pdfBuffer = Buffer.from(pdfBytes);
  const uploadBody = Buffer.concat([headerPart, pdfBuffer, footerPart]);

  const uploadRes = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: uploadBody,
    }
  );
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`PDF upload failed: ${uploadRes.status} — ${err}`);
  }

  const pdf = (await uploadRes.json()) as { id: string; webViewLink: string };
  return { fileId: pdf.id, fileName: pdfName, webViewLink: pdf.webViewLink };
}

export async function createFolder(
  userId: string,
  name: string,
  parentPath = "Personal"
): Promise<{ folderId: string; folderPath: string }> {
  const token = await getValidToken(userId);
  const parentFolderId = await resolveFolderPath(userId, parentPath);
  const folderId = await ensureFolderByName(token, name, parentFolderId);
  return { folderId, folderPath: `${parentPath}/${name}` };
}

// ── User Drive folder IDs (for tool executor context) ────────

export async function getUserDriveFolderPath(userId: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from("users")
    .select("google_drive_personal_id")
    .eq("id", userId)
    .single();
  return user?.google_drive_personal_id ? "Personal" : "Personal";
}
