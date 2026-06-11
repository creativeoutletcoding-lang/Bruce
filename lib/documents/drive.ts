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
const DRIVE_TIMEOUT_MS = 30_000;

function makeAbortSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// ── Types ────────────────────────────────────────────────────

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  webViewLink: string;
  modifiedTime: string;
  size?: string;
}

export interface DriveListResult {
  folderPath: string;
  files: DriveFileEntry[];
  warnings?: string[];
}

export interface PathResolutionStep {
  segment: string;
  folderId: string | null;
  duplicateCount: number;
  allFolderIds: Array<{ id: string; createdTime: string; childCount: number }>;
}

export interface PathResolutionResult {
  path: string;
  steps: PathResolutionStep[];
  resolvedFolderId: string | null;
  hasDuplicates: boolean;
}

// ── Low-level helpers ────────────────────────────────────────

async function driveGet(
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${DRIVE_API}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const { signal, clear } = makeAbortSignal(DRIVE_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[drive] GET ${path} failed: ${res.status} — ${err}`);
      throw new Error(`Drive API error ${res.status}: ${err}`);
    }
    return res.json() as Promise<Record<string, unknown>>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error(`[drive] GET ${path} timed out after ${DRIVE_TIMEOUT_MS / 1000}s`);
      throw new Error(`Drive API timed out after ${DRIVE_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clear();
  }
}

// Returns all folders with the given name under parentId, sorted oldest-first.
async function findAllFoldersByName(
  token: string,
  name: string,
  parentId: string
): Promise<Array<{ id: string; createdTime: string }>> {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`;
  const data = await driveGet(token, "/files", {
    q,
    fields: "files(id,createdTime)",
    orderBy: "createdTime asc",
    pageSize: "10",
  });
  return (data.files ?? []) as Array<{ id: string; createdTime: string }>;
}

// Returns the number of children in a folder (capped at 10 for efficiency).
async function getFolderChildCount(token: string, folderId: string): Promise<number> {
  const data = await driveGet(token, "/files", {
    q: `'${folderId}' in parents and trashed=false`,
    fields: "files(id)",
    pageSize: "10",
  });
  return ((data.files ?? []) as unknown[]).length;
}

// Prefers the folder with children when duplicates exist.
// If only one candidate has children, use it. If both or neither have children, use the oldest.
async function findFolderByName(
  token: string,
  name: string,
  parentId: string
): Promise<string | null> {
  const matches = await findAllFoldersByName(token, name, parentId);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].id;

  const counts = await Promise.all(matches.map((m) => getFolderChildCount(token, m.id)));
  const withChildren = matches.filter((_, i) => counts[i] > 0);
  if (withChildren.length === 1) return withChildren[0].id;
  return matches[0].id; // oldest-first fallback when 0 or 2+ have children
}

async function ensureFolderByName(
  token: string,
  name: string,
  parentId: string
): Promise<string> {
  const existing = await findFolderByName(token, name, parentId);
  if (existing) return existing;

  const { signal, clear } = makeAbortSignal(DRIVE_TIMEOUT_MS);
  try {
    const res = await fetch(`${DRIVE_API}/files`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[drive] create folder "${name}" failed: ${res.status} — ${err}`);
      throw new Error(`Drive create folder error ${res.status}: ${err}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error(`[drive] create folder "${name}" timed out after ${DRIVE_TIMEOUT_MS / 1000}s`);
      throw new Error(`Drive folder creation timed out after ${DRIVE_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clear();
  }
}

// ── Path resolution ──────────────────────────────────────────

// Resolves a Bruce-relative path like "Personal", "Projects/CPS", "Shared"
// to a Drive folder ID.
// strict=true: throws if any segment is not found (used for listing — prevents phantom folder creation).
// strict=false (default): creates missing intermediate folders (used for file creation/move).
// Only traverses within the Bruce root — cannot escape.
export async function resolveFolderPath(
  userId: string,
  folderPath: string,
  strict = false
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
    if (strict) {
      throw new Error(`Folder not found: "${root}" is not a valid root. Use Personal, Projects, or Shared.`);
    }
    currentId = await ensureFolderByName(token, root, personalId);
  }

  // Traverse remaining path segments
  for (const segment of rest) {
    if (strict) {
      const found = await findFolderByName(token, segment, currentId);
      if (!found) {
        throw new Error(
          `Folder not found: "${segment}" does not exist at this path. ` +
          `Use list_drive_files with folder_id to navigate into subfolders by their Drive ID.`
        );
      }
      currentId = found;
    } else {
      currentId = await ensureFolderByName(token, segment, currentId);
    }
  }

  return currentId;
}

// ── Public API ───────────────────────────────────────────────

// folderId: when provided, skips path resolution and lists the given Drive folder directly.
// Use this for subfolder navigation — pass the id from a previous listing result.
export async function listFiles(
  userId: string,
  folderPath = "Personal",
  folderId?: string
): Promise<DriveListResult> {
  const token = await getValidToken(userId);
  const resolvedFolderId = folderId ?? await resolveFolderPath(userId, folderPath, true);

  const data = await driveGet(token, "/files", {
    q: `'${resolvedFolderId}' in parents and trashed=false`,
    fields: "files(id,name,mimeType,webViewLink,modifiedTime,size)",
    orderBy: "folder,name",
    pageSize: "100",
  });

  const files = (data.files ?? []) as Array<{
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    modifiedTime: string;
    size?: string;
  }>;

  const mapped = files.map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    isFolder: f.mimeType === "application/vnd.google-apps.folder",
    webViewLink: f.webViewLink ?? "",
    modifiedTime: f.modifiedTime,
    size: f.size,
  }));

  // Detect duplicate-named subfolders — symptom of phantom folder creation
  const folderNameCounts = new Map<string, number>();
  for (const f of mapped) {
    if (f.isFolder) folderNameCounts.set(f.name, (folderNameCounts.get(f.name) ?? 0) + 1);
  }
  const warnings: string[] = [];
  for (const [name, count] of folderNameCounts) {
    if (count > 1) {
      warnings.push(
        `Duplicate folder: "${name}" appears ${count} times in this listing. ` +
        `This usually means a phantom empty folder was created alongside the real one. ` +
        `Use resolve_drive_path to identify which ID is correct, then navigate with folder_id.`
      );
    }
  }

  return {
    folderPath: folderId ? `(folder_id:${folderId})` : folderPath,
    files: mapped,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// Returns step-by-step resolution of a folder path with all candidate folder IDs at each step.
// Use this to diagnose which Drive folder IDs Bruce is navigating through.
export async function resolvePathDebug(
  userId: string,
  folderPath: string
): Promise<PathResolutionResult> {
  const token = await getValidToken(userId);
  const { rootId, personalId, projectsId } = await ensureBruceFolders(userId);

  const parts = folderPath.trim().replace(/^\/|\/$/g, "").split("/").filter(Boolean);
  const steps: PathResolutionStep[] = [];
  let hasDuplicates = false;

  if (parts.length === 0) {
    steps.push({ segment: "(root)", folderId: personalId, duplicateCount: 0, allFolderIds: [{ id: personalId, createdTime: "(cached)", childCount: -1 }] });
    return { path: folderPath, steps, resolvedFolderId: personalId, hasDuplicates };
  }

  const [root, ...rest] = parts;
  const normalized = root.toLowerCase();
  let currentId: string | null;

  async function enrichCandidates(
    candidates: Array<{ id: string; createdTime: string }>
  ): Promise<Array<{ id: string; createdTime: string; childCount: number }>> {
    const counts = await Promise.all(candidates.map((c) => getFolderChildCount(token, c.id)));
    return candidates.map((c, i) => ({ ...c, childCount: counts[i] }));
  }

  if (normalized === "personal") {
    currentId = personalId;
    steps.push({ segment: root, folderId: personalId, duplicateCount: 0, allFolderIds: [{ id: personalId, createdTime: "(cached)", childCount: -1 }] });
  } else if (normalized === "projects") {
    currentId = projectsId;
    steps.push({ segment: root, folderId: projectsId, duplicateCount: 0, allFolderIds: [{ id: projectsId, createdTime: "(cached)", childCount: -1 }] });
  } else if (normalized === "shared") {
    const candidates = await findAllFoldersByName(token, "Shared", rootId);
    const enriched = await enrichCandidates(candidates);
    const withChildren = enriched.filter((c) => c.childCount > 0);
    currentId = withChildren.length === 1 ? withChildren[0].id : (enriched[0]?.id ?? null);
    if (candidates.length > 1) hasDuplicates = true;
    steps.push({ segment: root, folderId: currentId, duplicateCount: candidates.length, allFolderIds: enriched });
  } else {
    const candidates = await findAllFoldersByName(token, root, personalId);
    const enriched = await enrichCandidates(candidates);
    const withChildren = enriched.filter((c) => c.childCount > 0);
    currentId = withChildren.length === 1 ? withChildren[0].id : (enriched[0]?.id ?? null);
    if (candidates.length > 1) hasDuplicates = true;
    steps.push({ segment: root, folderId: currentId, duplicateCount: candidates.length, allFolderIds: enriched });
  }

  for (const segment of rest) {
    if (!currentId) {
      steps.push({ segment, folderId: null, duplicateCount: 0, allFolderIds: [] });
      continue;
    }
    const candidates = await findAllFoldersByName(token, segment, currentId);
    const enriched = await enrichCandidates(candidates);
    // Prefer folder with children; fall back to oldest
    const withChildren = enriched.filter((c) => c.childCount > 0);
    currentId = withChildren.length === 1 ? withChildren[0].id : (enriched[0]?.id ?? null);
    if (candidates.length > 1) hasDuplicates = true;
    steps.push({ segment, folderId: currentId, duplicateCount: candidates.length, allFolderIds: enriched });
  }

  return { path: folderPath, steps, resolvedFolderId: currentId, hasDuplicates };
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

/**
 * Move a Drive file to the trash (recoverable for ~30 days). Takes Google
 * Drive file IDs only — never Gmail message IDs. Returns the trashed file's
 * name so Bruce can confirm exactly what was trashed.
 */
export async function trashFile(
  userId: string,
  fileId: string
): Promise<{ fileId: string; fileName: string }> {
  const token = await getValidToken(userId);

  const { signal, clear } = makeAbortSignal(DRIVE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,name,trashed`, {
      method: "PATCH",
      signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
  } finally {
    clear();
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive trash failed: ${res.status} — ${err}`);
  }
  const file = (await res.json()) as { id: string; name: string };
  return { fileId: file.id, fileName: file.name };
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
