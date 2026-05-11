// ============================================================
// Bruce — Google Sheets service
// Creates, reads, and formats spreadsheets within the Bruce
// folder structure only. Requires 'spreadsheets' OAuth scope.
// All functions are server-side only.
// ============================================================

import { getValidToken } from "@/lib/google/auth";
import { resolveFolderPath } from "@/lib/documents/drive";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

// ── Types ────────────────────────────────────────────────────

export interface SheetData {
  headers?: string[];
  rows: (string | number | null)[][];
}

export interface CellNumberFormat {
  type: "TEXT" | "NUMBER" | "PERCENT" | "CURRENCY" | "DATE" | "TIME" | "DATE_TIME";
  pattern?: string; // e.g. "$#,##0.00"
}

export interface ColumnSpec {
  width?: number;          // pixels
  numberFormat?: CellNumberFormat;
  startRow?: number;       // 0-indexed row to begin applying format (default 1 = skip header)
}

export interface TabFormatSpec {
  freezeRows?: number;
  freezeColumns?: number;
  boldHeaders?: boolean;
  headerBackground?: { red: number; green: number; blue: number };
  columns?: Record<number, ColumnSpec>;
  numColumns?: number;
}

export interface SheetResult {
  fileId: string;
  fileUrl: string;
  sheetTitle: string;
  tabName: string;
}

export interface ReadSheetResult {
  tabName: string;
  headers: string[];
  rows: string[][];
}

// ── Helpers ──────────────────────────────────────────────────

async function sheetsPost(
  token: string,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SHEETS_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API POST ${path} failed: ${res.status} — ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function sheetsPut(
  token: string,
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${SHEETS_API}${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API PUT ${path} failed: ${res.status} — ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

async function sheetsGet(
  token: string,
  path: string,
  params?: Record<string, string>
): Promise<Record<string, unknown>> {
  const url = new URL(`${SHEETS_API}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API GET ${path} failed: ${res.status} — ${err}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

function buildFormatRequests(
  sheetId: number,
  spec: TabFormatSpec,
  numCols: number
): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [];
  const bold = spec.boldHeaders !== false;

  // Freeze rows/columns
  if ((spec.freezeRows ?? 1) > 0 || spec.freezeColumns) {
    requests.push({
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: spec.freezeRows ?? 1,
            frozenColumnCount: spec.freezeColumns ?? 0,
          },
        },
        fields: "gridProperties.frozenRowCount,gridProperties.frozenColumnCount",
      },
    });
  }

  // Bold + background on header row
  if (bold) {
    const bg = spec.headerBackground ?? { red: 0.851, green: 0.918, blue: 0.827 };
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: numCols || 26,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
            backgroundColor: bg,
          },
        },
        fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor",
      },
    });
  }

  // Per-column formatting
  if (spec.columns) {
    for (const [colIdxStr, colSpec] of Object.entries(spec.columns)) {
      const colIdx = Number(colIdxStr);
      const startRow = colSpec.startRow ?? 1;

      if (colSpec.numberFormat) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: startRow,
              endRowIndex: 10000,
              startColumnIndex: colIdx,
              endColumnIndex: colIdx + 1,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: colSpec.numberFormat.type,
                  pattern: colSpec.numberFormat.pattern ?? "",
                },
              },
            },
            fields: "userEnteredFormat.numberFormat",
          },
        });
      }

      if (colSpec.width) {
        requests.push({
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: colIdx,
              endIndex: colIdx + 1,
            },
            properties: { pixelSize: colSpec.width },
            fields: "pixelSize",
          },
        });
      }
    }
  }

  return requests;
}

function buildRowValues(
  data: SheetData
): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  if (data.headers && data.headers.length > 0) {
    rows.push(data.headers);
  }
  rows.push(...data.rows);
  return rows;
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
  if (!meta.ok) throw new Error(`Drive metadata fetch failed: ${meta.status}`);
  const { parents } = (await meta.json()) as { parents?: string[] };
  const removeParents = (parents ?? []).join(",");

  const url = new URL(`${DRIVE_API}/files/${fileId}`);
  url.searchParams.set("addParents", folderId);
  if (removeParents) url.searchParams.set("removeParents", removeParents);
  url.searchParams.set("fields", "id");

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive move to folder failed: ${res.status} — ${err}`);
  }
}

// ── Public API ───────────────────────────────────────────────

export async function createSheet(
  userId: string,
  title: string,
  data?: SheetData,
  formatting?: TabFormatSpec,
  folderPath = "Personal"
): Promise<SheetResult> {
  const token = await getValidToken(userId);

  const firstTabName = "Sheet1";
  const body: Record<string, unknown> = {
    properties: { title },
    sheets: [{ properties: { title: firstTabName } }],
  };

  const spreadsheet = await sheetsPost(token, "", body);
  const fileId = spreadsheet.spreadsheetId as string;
  const fileUrl = spreadsheet.spreadsheetUrl as string;

  // Move to Bruce folder
  const folderId = await resolveFolderPath(userId, folderPath);
  await moveToFolder(token, fileId, folderId);

  const sheets = spreadsheet.sheets as Array<{
    properties: { sheetId: number; title: string };
  }>;
  const sheetId = sheets[0].properties.sheetId;

  const requests: Record<string, unknown>[] = [];

  if (data) {
    const numCols = data.headers?.length ?? (data.rows[0]?.length ?? 0);
    if (formatting) {
      requests.push(...buildFormatRequests(sheetId, formatting, numCols));
    }
  }

  if (requests.length > 0) {
    await sheetsPost(token, `/${fileId}:batchUpdate`, { requests });
  }

  if (data) {
    const values = buildRowValues(data);
    if (values.length > 0) {
      await sheetsPut(token, `/${fileId}/values/A1?valueInputOption=USER_ENTERED`, {
        range: "A1",
        majorDimension: "ROWS",
        values,
      });
    }
  }

  return { fileId, fileUrl, sheetTitle: title, tabName: firstTabName };
}

export async function addTab(
  userId: string,
  fileId: string,
  tabName: string,
  data?: SheetData,
  formatting?: TabFormatSpec
): Promise<{ tabName: string; sheetId: number }> {
  const token = await getValidToken(userId);

  const addResp = await sheetsPost(token, `/${fileId}:batchUpdate`, {
    requests: [{ addSheet: { properties: { title: tabName } } }],
  });

  const replies = addResp.replies as Array<{
    addSheet: { properties: { sheetId: number } };
  }>;
  const sheetId = replies[0].addSheet.properties.sheetId;

  const requests: Record<string, unknown>[] = [];

  if (data) {
    const numCols = data.headers?.length ?? (data.rows[0]?.length ?? 0);
    if (formatting) {
      requests.push(...buildFormatRequests(sheetId, formatting, numCols));
    }
  }

  if (requests.length > 0) {
    await sheetsPost(token, `/${fileId}:batchUpdate`, { requests });
  }

  if (data) {
    const values = buildRowValues(data);
    if (values.length > 0) {
      await sheetsPut(token, `/${fileId}/values/${encodeURIComponent(tabName + "!A1")}?valueInputOption=USER_ENTERED`, {
        range: `${tabName}!A1`,
        majorDimension: "ROWS",
        values,
      });
    }
  }

  return { tabName, sheetId };
}

export async function readSheet(
  userId: string,
  fileId: string,
  sheetName?: string
): Promise<ReadSheetResult> {
  const token = await getValidToken(userId);

  // If no sheet name given, get the first sheet's title
  let resolvedTabName = sheetName ?? "Sheet1";
  if (!sheetName) {
    const meta = await sheetsGet(token, `/${fileId}`, {
      fields: "sheets.properties.title",
    });
    const sheets = meta.sheets as Array<{ properties: { title: string } }>;
    if (sheets?.length > 0) resolvedTabName = sheets[0].properties.title;
  }

  const range = sheetName ? `${sheetName}!A:ZZ` : "A:ZZ";
  const data = await sheetsGet(token, `/${fileId}/values/${encodeURIComponent(range)}`);
  const rawValues = (data.values ?? []) as string[][];

  if (rawValues.length === 0) {
    return { tabName: resolvedTabName, headers: [], rows: [] };
  }

  const headers = rawValues[0].map((h) => h ?? "");
  const rows = rawValues.slice(1);

  return { tabName: resolvedTabName, headers, rows };
}

export async function updateCells(
  userId: string,
  fileId: string,
  sheetName: string,
  range: string,
  values: (string | number | null)[][]
): Promise<void> {
  const token = await getValidToken(userId);
  const fullRange = `${sheetName}!${range}`;

  await sheetsPut(token, `/${fileId}/values/${encodeURIComponent(fullRange)}?valueInputOption=USER_ENTERED`, {
    range: fullRange,
    majorDimension: "ROWS",
    values,
  });
}

export async function formatTab(
  userId: string,
  fileId: string,
  sheetName: string,
  formatSpec: TabFormatSpec
): Promise<void> {
  const token = await getValidToken(userId);

  // Get sheetId for the named tab
  const meta = await sheetsGet(token, `/${fileId}`, {
    fields: "sheets.properties",
  });
  const sheets = meta.sheets as Array<{
    properties: { sheetId: number; title: string; gridProperties: { columnCount: number } };
  }>;
  const sheet = sheets.find((s) => s.properties.title === sheetName);
  if (!sheet) throw new Error(`Tab "${sheetName}" not found in spreadsheet ${fileId}`);

  const sheetId = sheet.properties.sheetId;
  const numCols =
    formatSpec.numColumns ?? sheet.properties.gridProperties?.columnCount ?? 26;

  const requests = buildFormatRequests(sheetId, formatSpec, numCols);
  if (requests.length === 0) return;

  await sheetsPost(token, `/${fileId}:batchUpdate`, { requests });
}
