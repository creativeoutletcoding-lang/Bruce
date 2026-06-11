// ============================================================
// Bruce — CSV generation and reading
// Saves CSVs to Google Drive and reads them back.
// Uses drive.file scope — no additional OAuth scopes required.
// All functions are server-side only.
// ============================================================

import { getValidToken } from "@/lib/google/auth";
import { resolveFolderPath } from "@/lib/documents/drive";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// ── Types ────────────────────────────────────────────────────

export interface CSVColumn {
  key: string;
  label?: string;
  format?: "text" | "number" | "currency" | "percent";
}

export interface CSVResult {
  fileId: string;
  fileName: string;
  webViewLink: string;
  rowCount: number;
  /** "updated" when an existing same-named file (or explicit fileId) was overwritten in place. */
  action: "created" | "updated";
}

export interface ReadCSVResult {
  fileId: string;
  fileName: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
}

// ── CSV serialization ────────────────────────────────────────

function escapeCSVField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function serializeCSV(
  data: Record<string, string | number | null>[],
  columns: CSVColumn[]
): string {
  const header = columns.map((c) => escapeCSVField(c.label ?? c.key)).join(",");
  const rows = data.map((row) =>
    columns.map((c) => escapeCSVField(row[c.key])).join(",")
  );
  return [header, ...rows].join("\r\n");
}

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let field = "";
        i++; // skip opening quote
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++; // skip closing quote
            break;
          } else {
            field += line[i++];
          }
        }
        fields.push(field);
        if (line[i] === ",") i++;
      } else {
        const end = line.indexOf(",", i);
        if (end === -1) {
          fields.push(line.slice(i));
          break;
        } else {
          fields.push(line.slice(i, end));
          i = end + 1;
        }
      }
    }
    return fields;
  }

  const headers = parseLine(nonEmpty[0]);
  const rows = nonEmpty.slice(1).map(parseLine);
  return { headers, rows };
}

const CSV_TIMEOUT_MS = 30_000;

function makeAbortSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

// ── Public API ───────────────────────────────────────────────

// Find a non-trashed file by exact name inside a folder. Used so repeated
// generate_csv calls overwrite the same file instead of accumulating copies.
async function findFileInFolder(
  token: string,
  folderId: string,
  name: string
): Promise<{ id: string; webViewLink: string } | null> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed = false`
  );
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,webViewLink)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null; // fall back to create on lookup failure
  const body = (await res.json()) as { files?: Array<{ id: string; webViewLink: string }> };
  return body.files?.[0] ?? null;
}

// Overwrite an existing Drive file's content in place (same fileId).
async function updateCSVContent(
  token: string,
  fileId: string,
  csvContent: string
): Promise<{ id: string; webViewLink: string }> {
  const { signal, clear } = makeAbortSignal(CSV_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(
      `${UPLOAD_API}/files/${fileId}?uploadType=media&fields=id,webViewLink`,
      {
        method: "PATCH",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/csv; charset=UTF-8",
        },
        body: csvContent,
      }
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Drive CSV update timed out after ${CSV_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clear();
  }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CSV update failed ${res.status}: ${err}`);
  }
  return (await res.json()) as { id: string; webViewLink: string };
}

export async function generateCSV(
  userId: string,
  data: Record<string, string | number | null>[],
  columns: CSVColumn[],
  fileName: string,
  folderPath = "Personal",
  explicitFileId?: string
): Promise<CSVResult> {
  console.error(`[csv.generateCSV] start fileName="${fileName}" folderPath="${folderPath}" rows=${data.length}`);

  const token = await getValidToken(userId);
  console.error(`[csv.generateCSV] got token`);

  const csvName = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  const csvContent = serializeCSV(data, columns);

  // Overwrite in place: an explicit fileId, or a same-named non-trashed file
  // already in the target folder, is updated instead of duplicated.
  if (explicitFileId) {
    const file = await updateCSVContent(token, explicitFileId, csvContent);
    console.error(`[csv.generateCSV] updated fileId=${file.id} (explicit)`);
    return { fileId: file.id, fileName: csvName, webViewLink: file.webViewLink, rowCount: data.length, action: "updated" };
  }

  const folderId = await resolveFolderPath(userId, folderPath);
  console.error(`[csv.generateCSV] resolved folder "${folderPath}" → ${folderId}`);

  const existing = await findFileInFolder(token, folderId, csvName);
  if (existing) {
    const file = await updateCSVContent(token, existing.id, csvContent);
    console.error(`[csv.generateCSV] updated fileId=${file.id} (same name in folder)`);
    return { fileId: file.id, fileName: csvName, webViewLink: file.webViewLink ?? existing.webViewLink, rowCount: data.length, action: "updated" };
  }

  console.error(`[csv.generateCSV] serialized ${csvContent.length} chars, uploading to folderId=${folderId}`);

  const boundary = `bruce_csv_${Date.now()}`;
  const metadata = JSON.stringify({
    name: csvName,
    mimeType: "text/csv",
    parents: [folderId],
  });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/csv; charset=UTF-8\r\n\r\n` +
    `${csvContent}\r\n` +
    `--${boundary}--`;

  const { signal, clear } = makeAbortSignal(CSV_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(
      `${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`,
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      console.error(`[csv.generateCSV] upload timed out after ${CSV_TIMEOUT_MS / 1000}s`);
      throw new Error(`Drive CSV upload timed out after ${CSV_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clear();
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`[csv.generateCSV] upload failed: ${res.status} — ${err}`);
    throw new Error(`CSV upload failed ${res.status}: ${err}`);
  }

  const file = (await res.json()) as { id: string; webViewLink: string };
  console.error(`[csv.generateCSV] upload ok fileId=${file.id}`);

  return {
    fileId: file.id,
    fileName: csvName,
    webViewLink: file.webViewLink,
    rowCount: data.length,
    action: "created",
  };
}

export async function readCSV(
  userId: string,
  fileId: string
): Promise<ReadCSVResult> {
  const token = await getValidToken(userId);

  const [metaRes, contentRes] = await Promise.all([
    fetch(`${DRIVE_API}/files/${fileId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  if (!metaRes.ok) throw new Error(`CSV readCSV metadata failed: ${metaRes.status}`);
  if (!contentRes.ok) throw new Error(`CSV readCSV content failed: ${contentRes.status}`);

  const { name: fileName } = (await metaRes.json()) as { name: string };
  const rawText = await contentRes.text();
  const { headers, rows } = parseCSV(rawText);

  return { fileId, fileName, headers, rows, rowCount: rows.length };
}
