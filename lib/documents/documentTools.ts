// ============================================================
// Bruce — Anthropic tool definitions + executor for document
// creation and manipulation (Sheets, Docs, Drive, CSV).
// Imported by all three chat routes.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { createSheet, addTab, readSheet, updateCells, formatTab } from "@/lib/documents/sheets";
import { createDoc, readDoc, updateDoc, appendDoc } from "@/lib/documents/docs";
import { listFiles, moveFile, exportAsPDF, createFolder, resolvePathDebug, trashFile } from "@/lib/documents/drive";
import { generateCSV, readCSV } from "@/lib/documents/csv";
import { getFileContent } from "@/lib/google/drive";
import type { TabFormatSpec, SheetData } from "@/lib/documents/sheets";
import type { CSVColumn } from "@/lib/documents/csv";

// ── Tool definitions ──────────────────────────────────────────

export const DOCUMENT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "create_spreadsheet",
    description:
      "Create a new Google Sheet in the Bruce Drive folder and optionally populate it with data. " +
      "Use for payroll tables, tracking sheets, data exports, budgets, or any tabular data. " +
      "IMPORTANT: Confirm before creating — describe the sheet and ask first. Once confirmed, call this tool immediately. " +
      "folder_path examples: 'Personal', 'Projects/CPS', 'Projects/FIG'. Default: Personal.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Spreadsheet title." },
        folder_path: {
          type: "string",
          description: "Bruce Drive folder path. Default: 'Personal'.",
        },
        headers: {
          type: "array",
          items: { type: "string" },
          description: "Column header names for the first row.",
        },
        rows: {
          type: "array",
          items: { type: "array", items: {} },
          description: "Data rows as arrays of values (string, number, or null).",
        },
        freeze_rows: {
          type: "number",
          description: "Rows to freeze (default: 1 = freeze header row).",
        },
        bold_headers: {
          type: "boolean",
          description: "Make the header row bold with a light background. Default: true.",
        },
        currency_columns: {
          type: "array",
          items: { type: "number" },
          description:
            "0-indexed column indices to format as currency ($#,##0.00). " +
            "Example: [2, 3, 4] formats columns C, D, E as dollar amounts.",
        },
        column_widths: {
          type: "object",
          description: "Map of 0-indexed column index to pixel width. Example: {\"0\": 200, \"1\": 120}.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "read_spreadsheet",
    description:
      "Read data from an existing Google Sheet. Returns headers and all data rows. " +
      "Use this to check existing sheet contents before making updates.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID of the spreadsheet." },
        sheet_name: {
          type: "string",
          description: "Tab name to read. Omit to read the first tab.",
        },
      },
      required: ["file_id"],
    },
  },
  {
    name: "update_spreadsheet_cells",
    description:
      "Write values to a specific range of cells in an existing Google Sheet. " +
      "IMPORTANT: Confirm before overwriting — describe what will change and ask first. " +
      "Range format: 'A1', 'A2:D10', 'B3'. Values is a 2D array (rows of columns).",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID." },
        sheet_name: { type: "string", description: "Tab name to write to." },
        range: { type: "string", description: "A1 notation range, e.g. 'A2:D10' or 'B5'." },
        values: {
          type: "array",
          items: { type: "array", items: {} },
          description: "2D array of values. Each inner array is one row.",
        },
      },
      required: ["file_id", "sheet_name", "range", "values"],
    },
  },
  {
    name: "add_spreadsheet_tab",
    description:
      "Add a new tab to an existing Google Sheet workbook, optionally with data and formatting. " +
      "Use for adding payroll periods, months, or categories to an existing workbook. " +
      "Confirm before adding — describe the tab and ask first.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID of the existing spreadsheet." },
        tab_name: { type: "string", description: "Name for the new tab." },
        title_row: {
          type: "string",
          description:
            "Optional merged title spanning the full width of the tab (row 1). When set, " +
            "column headers go in row 2 and data starts in row 3. freeze_rows defaults to 2. " +
            "Example: \"Capital Petsitters Payroll  |  April 27, 2026 – May 10, 2026\"",
        },
        headers: {
          type: "array",
          items: { type: "string" },
          description: "Column headers. When title_row is set these go in row 2.",
        },
        rows: {
          type: "array",
          items: { type: "array", items: {} },
          description: "Data rows.",
        },
        freeze_rows: { type: "number", description: "Rows to freeze. Default: 1, or 2 when title_row is set." },
        bold_headers: { type: "boolean", description: "Bold header row. Default: true." },
        currency_columns: {
          type: "array",
          items: { type: "number" },
          description: "0-indexed column indices to format as currency.",
        },
      },
      required: ["file_id", "tab_name"],
    },
  },
  {
    name: "format_spreadsheet_tab",
    description:
      "Apply formatting to an existing tab in a spreadsheet — freeze rows, bold headers, " +
      "currency formatting, column widths. Does not change data, only appearance.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID." },
        sheet_name: { type: "string", description: "Tab name to format." },
        freeze_rows: { type: "number", description: "Rows to freeze. Default: 1." },
        freeze_columns: { type: "number", description: "Columns to freeze. Default: 0." },
        bold_headers: { type: "boolean", description: "Bold row 0. Default: true." },
        currency_columns: {
          type: "array",
          items: { type: "number" },
          description: "0-indexed column indices to format as $#,##0.00.",
        },
        column_widths: {
          type: "object",
          description: "Map of column index to pixel width.",
        },
        num_columns: {
          type: "number",
          description: "Total number of columns (used to scope header bold range).",
        },
      },
      required: ["file_id", "sheet_name"],
    },
  },
  {
    name: "create_document",
    description:
      "Create a new Google Doc in the Bruce Drive folder. " +
      "IMPORTANT: Confirm before creating — describe the document and ask first. Once confirmed, call this tool immediately. " +
      "Use for reports, meeting notes, letters, summaries, contracts, or any text document.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Document title." },
        content: { type: "string", description: "Initial text content. Plain text." },
        folder_path: {
          type: "string",
          description: "Bruce Drive folder path. Default: 'Personal'.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "read_document",
    description:
      "Read the text content of an existing Google Doc. " +
      "Use this before updating a doc to understand current contents.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID of the document." },
      },
      required: ["file_id"],
    },
  },
  {
    name: "update_document",
    description:
      "Replace the full content of an existing Google Doc. " +
      "HIGH STAKES: this overwrites all existing content. " +
      "Always read the doc first, describe exactly what will change, and get explicit confirmation before calling.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID." },
        content: { type: "string", description: "New document content. Plain text." },
      },
      required: ["file_id", "content"],
    },
  },
  {
    name: "append_document",
    description:
      "Append content to the end of an existing Google Doc without touching existing content. " +
      "Confirm before appending — describe what will be added and ask first.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID." },
        content: { type: "string", description: "Text to append." },
      },
      required: ["file_id", "content"],
    },
  },
  {
    name: "list_drive_files",
    description:
      "List files and subfolders in any Google Drive folder the user owns. Results include folders with isFolder:true and their Drive IDs. " +
      "Use folder_id when you have a known Drive folder ID — this works for any folder, including external folders not inside the Bruce/ structure. " +
      "Use folder_path only for Bruce's own folders (Personal, Projects/<name>, Shared). " +
      "Use to check what files exist before creating or referencing them. Never ask the user for a file ID — list the folder and find it yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        folder_path: {
          type: "string",
          description: "Bruce Drive folder path. Examples: 'Personal', 'Projects/CPS', 'Shared'. Default: 'Personal'. Only works one level deep under Projects — use folder_id for deeper or external navigation.",
        },
        folder_id: {
          type: "string",
          description: "Google Drive folder ID to list directly. Works with any Drive folder the user owns — use when you have a known ID from project instructions, from the user, or from a previous listing. Takes precedence over folder_path.",
        },
      },
    },
  },
  {
    name: "resolve_drive_path",
    description:
      "Resolve a Bruce Drive folder path step by step, showing the exact Drive folder ID chosen at each segment. " +
      "Use this when list_drive_files returns unexpected results or empty folders — it reveals duplicate phantom folders " +
      "alongside real ones and shows which ID was selected (always the oldest). " +
      "Also use this before navigating into a subfolder to confirm the correct folder_id.",
    input_schema: {
      type: "object" as const,
      properties: {
        folder_path: {
          type: "string",
          description: "Bruce Drive folder path to resolve. Example: 'Projects/CPS PAYROLL/Imports'.",
        },
      },
      required: ["folder_path"],
    },
  },
  {
    name: "export_as_pdf",
    description:
      "Export a Google Doc as a PDF and save it to Drive. " +
      "The PDF is saved alongside the original file unless destination_path is specified. " +
      "Confirm before exporting — tell the user what will be created.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID of the document to export." },
        destination_path: {
          type: "string",
          description: "Bruce Drive folder to save the PDF. Defaults to same folder as the source.",
        },
      },
      required: ["file_id"],
    },
  },
  {
    name: "generate_csv",
    description:
      "Generate a CSV file from structured data and save it to Bruce Drive. " +
      "Use for payroll exports, data dumps, reports, or anything that needs to be opened in Excel/Sheets. " +
      "Overwrites in place: if a file with the same name already exists in the target folder " +
      "(or a file_id is passed), that file is updated — same fileId, no duplicate copies. " +
      "Confirm before generating — describe the file and ask first.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_name: { type: "string", description: "File name (with or without .csv extension)." },
        folder_path: {
          type: "string",
          description: "Bruce Drive folder path. Default: 'Personal'.",
        },
        file_id: {
          type: "string",
          description:
            "Optional Google Drive file ID of an existing CSV to overwrite in place. " +
            "When omitted, a same-named file in the target folder is overwritten automatically.",
        },
        columns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Data key to pull from each row object." },
              label: { type: "string", description: "Column header label (defaults to key)." },
            },
            required: ["key"],
          },
          description: "Column definitions.",
        },
        data: {
          type: "array",
          items: { type: "object" },
          description: "Array of row objects. Each object's keys should match column keys.",
        },
      },
      required: ["file_name", "columns", "data"],
    },
  },
  {
    name: "read_csv",
    description:
      "Read a CSV file from Bruce Drive and return its headers and data rows.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID of the CSV file." },
      },
      required: ["file_id"],
    },
  },
  {
    name: "trash_drive_file",
    description:
      "Google Drive file IDs only — never Gmail message IDs. " +
      "Moves the file to Drive trash (recoverable for 30 days). " +
      "Confirm before trashing files the user created. Duplicates you created " +
      "yourself in the current session may be trashed without confirmation when " +
      "the user asked for cleanup.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_id: { type: "string", description: "Google Drive file ID of the file to trash." },
      },
      required: ["file_id"],
    },
  },
];

// ── Tool name set for routing ──────────────────────────────────

export const DOCUMENT_TOOL_NAMES = new Set(
  DOCUMENT_TOOLS.map((t) => t.name)
);

// ── System prompt block ────────────────────────────────────────

export const DOCUMENT_SYSTEM_BLOCK = `

## Document creation and management

You can create and manage Google Sheets, Google Docs, and CSV files in the Bruce Drive folder.

**Folder structure** — all files live within Bruce/:
- \`Personal\` — standalone files not tied to a project
- \`Projects/<name>\` — files for a specific project (use the project name exactly)
- \`Shared\` — files for multiple members

**Confirmation rules:**
- Reading or listing: no confirmation needed — just do it.
- Creating a file: medium stakes — describe what you'll create and ask "I can create this — want me to go ahead?"
- Updating or appending a document: medium stakes — describe the change and confirm.
- Overwriting a document (update_document): high stakes — always read first, describe exactly what changes, get explicit yes.
- Exporting or generating: medium stakes — describe the output and confirm.
- Trashing a Drive file (trash_drive_file): confirm before trashing files the user created — name the file and ask. Duplicate files you created yourself in the current session may be trashed without confirmation when the user asked for cleanup. trash_drive_file takes Google Drive file IDs only — never Gmail message IDs (and delete_email takes Gmail message IDs only — never Drive file IDs).

**CSV overwrite behavior:** generate_csv overwrites in place — a same-named file in the target folder (or an explicit file_id) is updated with the same fileId rather than duplicated. The result reports action: "created" or "updated".

**After confirmation:** call the tool immediately — do not say "I'll now create..." or otherwise announce the tool call. Report the result (title, URL) once the tool returns.

**If a tool returns an error:** surface the failure clearly. State what failed and why (e.g. "Couldn't create the document — the Google API returned a permission error"). Do not silently recover or pretend the operation succeeded.

**Spreadsheet formatting for payroll and financial data:**
Use \`currency_columns\` (array of 0-indexed column indices) to format monetary columns as $#,##0.00. Always freeze the header row (\`freeze_rows: 1\`) and bold headers.

**CPS payroll tab format (add_spreadsheet_tab):**
Every CPS payroll tab must match this exact layout:
- \`tab_name\`: payment date in MMDDYYYY format (e.g. "05182026"). Use the payment date confirmed by the user — NOT the import file date.
- \`title_row\`: \`"Capital Petsitters Payroll  |  [Period Start] – [Period End]"\` (e.g. "Capital Petsitters Payroll  |  April 27, 2026 – May 10, 2026"). This merges across all columns as row 1.
- \`headers\` (row 2): \`["User", "Period Start", "Period End", "Visit Pay", "Tips", "Gross Pay", "WC Deduction", "Total Pay", "Notes"]\` — use these exact names, in this order.
- \`rows\` (row 3+): one row per sitter with all 9 values. Period Start and Period End are the pay period dates (e.g. "April 27, 2026"). Visit Pay, Tips, Gross Pay, WC Deduction, Total Pay are dollar amounts. Notes can be empty string if none.
- \`currency_columns\`: [3, 4, 5, 6, 7] (Visit Pay through Total Pay, 0-indexed).
- \`freeze_rows\` is automatically set to 2 when \`title_row\` is provided.

**When a file ID is needed:** use \`list_drive_files\` to find existing files in the relevant folder. Never guess a file ID. Never ask the user for a file ID — resolve it yourself.

**Known folder IDs:** if you have a Drive folder ID (from project instructions, from context, or told by the user), pass it directly as \`folder_id\` to \`list_drive_files\`. The folder does not need to be inside the Bruce/ structure — \`folder_id\` works for any folder the user owns. Do not attempt path resolution for a folder you already have an ID for.

**Navigating subfolders:** \`list_drive_files\` results include subfolders with \`isFolder: true\` and their Drive \`id\`. To list the contents of a subfolder, call \`list_drive_files\` with \`folder_id\` set to that entry's \`id\` — do not construct deep \`folder_path\` strings (path resolution only works one level under Projects/Personal/Shared). Example: you have folder ID \`abc123\` for a payroll folder → call \`list_drive_files\` with \`folder_id: "abc123"\` → find the Imports entry (\`isFolder: true\`) → call \`list_drive_files\` with \`folder_id: "<imports id>"\` to list its contents.

**Duplicate folders (phantom cleanup):** If \`list_drive_files\` returns a \`warnings\` field mentioning duplicate folder names, or if a folder appears empty when it should have files, use \`resolve_drive_path\` first. It shows every candidate folder ID at each path segment (with \`duplicateCount\` and \`allFolderIds\`). Path resolution prefers the folder with children over an empty one when duplicates exist (real folders have content; phantoms are empty). If both or neither have children it falls back to oldest. Each candidate in \`allFolderIds\` now includes a \`childCount\` field (capped at 10) so you can verify which folder was selected and why. If the wrong ID is still selected, tell the user exactly which IDs and child counts exist so they can delete the empty phantom from Google Drive directly.`;

// ── Status sentinels ───────────────────────────────────────────

export const DOCUMENT_STATUS_SENTINEL = "\x1eSTATUS:Working on document…\x1e";

// ── Tool executor ──────────────────────────────────────────────

export async function executeDocumentTool(
  name: string,
  input: Record<string, unknown>,
  userId: string
): Promise<string> {
  switch (name) {
    case "create_spreadsheet": {
      const headers = input.headers as string[] | undefined;
      const rows = (input.rows as (string | number | null)[][] | undefined) ?? [];
      const data: SheetData | undefined = headers || rows.length > 0
        ? { headers, rows }
        : undefined;

      const currencyCols = input.currency_columns as number[] | undefined;
      const widths = input.column_widths as Record<string, number> | undefined;

      const columns: TabFormatSpec["columns"] = {};
      if (currencyCols) {
        for (const col of currencyCols) {
          columns[col] = { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } };
        }
      }
      if (widths) {
        for (const [idx, px] of Object.entries(widths)) {
          columns[Number(idx)] = { ...columns[Number(idx)], width: px };
        }
      }

      const formatting: TabFormatSpec | undefined = (currencyCols || widths || input.freeze_rows !== undefined || input.bold_headers !== undefined)
        ? {
            freezeRows: (input.freeze_rows as number | undefined) ?? 1,
            boldHeaders: (input.bold_headers as boolean | undefined) ?? true,
            columns: Object.keys(columns).length > 0 ? columns : undefined,
          }
        : { freezeRows: 1, boldHeaders: true };

      const result = await createSheet(
        userId,
        input.title as string,
        data,
        formatting,
        (input.folder_path as string | undefined) ?? "Personal"
      );
      return JSON.stringify({
        success: true,
        file_id: result.fileId,
        url: result.fileUrl,
        title: result.sheetTitle,
        tab: result.tabName,
      });
    }

    case "read_spreadsheet": {
      const fileId = input.file_id as string;
      try {
        const result = await readSheet(
          userId,
          fileId,
          input.sheet_name as string | undefined
        );
        return JSON.stringify(result);
      } catch {
        // Sheets API rejects non-native-Sheet files (.xls HTML exports from Precise Petcare,
        // Office binaries, etc.). Fall back to raw Drive download via ?alt=media.
        const rawContent = await getFileContent(userId, fileId);
        if (rawContent) return JSON.stringify({ raw: rawContent });
        throw new Error(`Cannot read file ${fileId}: not a Google Sheet and raw content is unavailable`);
      }
    }

    case "update_spreadsheet_cells": {
      await updateCells(
        userId,
        input.file_id as string,
        input.sheet_name as string,
        input.range as string,
        input.values as (string | number | null)[][]
      );
      return JSON.stringify({ success: true });
    }

    case "add_spreadsheet_tab": {
      const headers = input.headers as string[] | undefined;
      const rows = (input.rows as (string | number | null)[][] | undefined) ?? [];
      const titleRow = input.title_row as string | undefined;
      const data: SheetData | undefined = headers || rows.length > 0 || titleRow
        ? { titleRow, headers, rows }
        : undefined;

      const currencyCols = input.currency_columns as number[] | undefined;
      const columns: TabFormatSpec["columns"] = {};
      if (currencyCols) {
        for (const col of currencyCols) {
          columns[col] = { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } };
        }
      }

      const formatting: TabFormatSpec = {
        freezeRows: (input.freeze_rows as number | undefined) ?? 1,
        boldHeaders: (input.bold_headers as boolean | undefined) ?? true,
        columns: Object.keys(columns).length > 0 ? columns : undefined,
      };

      const result = await addTab(
        userId,
        input.file_id as string,
        input.tab_name as string,
        data,
        formatting
      );
      return JSON.stringify({ success: true, tab_name: result.tabName, sheet_id: result.sheetId });
    }

    case "format_spreadsheet_tab": {
      const currencyCols = input.currency_columns as number[] | undefined;
      const widths = input.column_widths as Record<string, number> | undefined;
      const columns: TabFormatSpec["columns"] = {};

      if (currencyCols) {
        for (const col of currencyCols) {
          columns[col] = { numberFormat: { type: "CURRENCY", pattern: "$#,##0.00" } };
        }
      }
      if (widths) {
        for (const [idx, px] of Object.entries(widths)) {
          columns[Number(idx)] = { ...columns[Number(idx)], width: px };
        }
      }

      await formatTab(userId, input.file_id as string, input.sheet_name as string, {
        freezeRows: input.freeze_rows as number | undefined,
        freezeColumns: input.freeze_columns as number | undefined,
        boldHeaders: (input.bold_headers as boolean | undefined) ?? true,
        columns: Object.keys(columns).length > 0 ? columns : undefined,
        numColumns: input.num_columns as number | undefined,
      });
      return JSON.stringify({ success: true });
    }

    case "create_document": {
      const result = await createDoc(
        userId,
        input.title as string,
        input.content as string | undefined,
        (input.folder_path as string | undefined) ?? "Personal"
      );
      return JSON.stringify({
        success: true,
        file_id: result.fileId,
        url: result.fileUrl,
        title: result.title,
      });
    }

    case "read_document": {
      const result = await readDoc(userId, input.file_id as string);
      return JSON.stringify(result);
    }

    case "update_document": {
      await updateDoc(userId, input.file_id as string, input.content as string);
      return JSON.stringify({ success: true });
    }

    case "append_document": {
      await appendDoc(userId, input.file_id as string, input.content as string);
      return JSON.stringify({ success: true });
    }

    case "list_drive_files": {
      const result = await listFiles(
        userId,
        (input.folder_path as string | undefined) ?? "Personal",
        input.folder_id as string | undefined
      );
      return JSON.stringify(result);
    }

    case "resolve_drive_path": {
      const result = await resolvePathDebug(userId, input.folder_path as string);
      return JSON.stringify(result);
    }

    case "export_as_pdf": {
      const result = await exportAsPDF(
        userId,
        input.file_id as string,
        input.destination_path as string | undefined
      );
      return JSON.stringify({
        success: true,
        file_id: result.fileId,
        file_name: result.fileName,
        url: result.webViewLink,
      });
    }

    case "generate_csv": {
      const columns = input.columns as CSVColumn[];
      const data = input.data as Record<string, string | number | null>[];
      const result = await generateCSV(
        userId,
        data,
        columns,
        input.file_name as string,
        (input.folder_path as string | undefined) ?? "Personal",
        input.file_id as string | undefined
      );
      return JSON.stringify({
        success: true,
        action: result.action,
        file_id: result.fileId,
        file_name: result.fileName,
        url: result.webViewLink,
        row_count: result.rowCount,
      });
    }

    case "read_csv": {
      const result = await readCSV(userId, input.file_id as string);
      return JSON.stringify(result);
    }

    case "trash_drive_file": {
      const result = await trashFile(userId, input.file_id as string);
      return JSON.stringify({
        success: true,
        trashed: true,
        file_id: result.fileId,
        file_name: result.fileName,
      });
    }

    default:
      return `Unknown document tool: ${name}`;
  }
}
