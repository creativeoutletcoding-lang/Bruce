// ============================================================
// Bruce — Google Docs service
// Creates and manipulates Google Docs within Bruce folders.
// Requires 'documents' OAuth scope for batchUpdate operations.
// All functions are server-side only.
// ============================================================

import { getValidToken } from "@/lib/google/auth";
import { resolveFolderPath } from "@/lib/documents/drive";

const DOCS_API = "https://docs.googleapis.com/v1/documents";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// ── Types ────────────────────────────────────────────────────

export interface DocResult {
  fileId: string;
  fileUrl: string;
  title: string;
}

export interface ReadDocResult {
  fileId: string;
  title: string;
  content: string;
  wordCount: number;
}

// ── Helpers ──────────────────────────────────────────────────

async function docsPost(
  token: string,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${DOCS_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Docs API POST ${path} failed: ${res.status} — ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function moveToFolder(
  token: string,
  fileId: string,
  folderId: string
): Promise<void> {
  const meta = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=parents`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { parents } = (await meta.json()) as { parents?: string[] };
  const removeParents = (parents ?? []).join(",");

  const url = new URL(`${DRIVE_API}/files/${fileId}`);
  url.searchParams.set("addParents", folderId);
  if (removeParents) url.searchParams.set("removeParents", removeParents);
  url.searchParams.set("fields", "id");

  await fetch(url.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function getDocEndIndex(token: string, fileId: string): Promise<number> {
  const res = await fetch(`${DOCS_API}/${fileId}?fields=body.content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Docs API GET /${fileId} failed: ${res.status}`);
  const doc = (await res.json()) as {
    body: { content: Array<{ endIndex?: number }> };
  };
  const content = doc.body?.content ?? [];
  const last = content[content.length - 1];
  return (last?.endIndex ?? 2) - 1; // subtract 1 — the trailing newline is not writable
}

// ── Public API ───────────────────────────────────────────────

export async function createDoc(
  userId: string,
  title: string,
  content?: string,
  folderPath = "Personal"
): Promise<DocResult> {
  const token = await getValidToken(userId);

  // Create the doc via Drive API (multipart upload with plain text content)
  // This avoids needing to call the Docs batchUpdate API for initial content.
  const boundary = `bruce_doc_${Date.now()}`;
  const metadata = JSON.stringify({
    name: title,
    mimeType: "application/vnd.google-apps.document",
  });
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n` +
    `${content ?? ""}\r\n` +
    `--${boundary}--`;

  const uploadRes = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Docs create failed: ${uploadRes.status} — ${err}`);
  }

  const file = (await uploadRes.json()) as { id: string; webViewLink: string };

  const folderId = await resolveFolderPath(userId, folderPath);
  await moveToFolder(token, file.id, folderId);

  return {
    fileId: file.id,
    fileUrl: file.webViewLink,
    title,
  };
}

export async function readDoc(
  userId: string,
  fileId: string
): Promise<ReadDocResult> {
  const token = await getValidToken(userId);

  // Export as plain text via Drive API — works with drive.file scope
  const [metaRes, exportRes] = await Promise.all([
    fetch(`${DRIVE_API}/files/${fileId}?fields=id,name`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    fetch(
      `${DRIVE_API}/files/${fileId}/export?mimeType=text%2Fplain`,
      { headers: { Authorization: `Bearer ${token}` } }
    ),
  ]);

  if (!metaRes.ok) throw new Error(`Docs readDoc metadata failed: ${metaRes.status}`);
  if (!exportRes.ok) throw new Error(`Docs readDoc export failed: ${exportRes.status}`);

  const { name: title } = (await metaRes.json()) as { name: string };
  const content = await exportRes.text();
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  return { fileId, title, content, wordCount };
}

export async function updateDoc(
  userId: string,
  fileId: string,
  content: string
): Promise<void> {
  const token = await getValidToken(userId);

  // Get current document end index to delete all existing content
  const endIndex = await getDocEndIndex(token, fileId);

  const requests: Record<string, unknown>[] = [];

  // Delete all existing content if there is any (endIndex > 1)
  if (endIndex > 1) {
    requests.push({
      deleteContentRange: {
        range: { startIndex: 1, endIndex },
      },
    });
  }

  // Insert new content at the beginning
  if (content.trim()) {
    requests.push({
      insertText: { location: { index: 1 }, text: content },
    });
  }

  if (requests.length > 0) {
    await docsPost(token, `/${fileId}:batchUpdate`, { requests });
  }
}

export async function appendDoc(
  userId: string,
  fileId: string,
  content: string
): Promise<void> {
  if (!content.trim()) return;
  const token = await getValidToken(userId);

  const endIndex = await getDocEndIndex(token, fileId);

  // Append with a leading newline if the doc already has content
  const textToInsert = endIndex > 1 ? `\n${content}` : content;

  await docsPost(token, `/${fileId}:batchUpdate`, {
    requests: [
      {
        insertText: {
          location: { index: endIndex },
          text: textToInsert,
        },
      },
    ],
  });
}
