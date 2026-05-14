// Diagnostic endpoint — verifies Sheets API write access to the CPS PAYROLL workbook.
// Requires authentication. Attempts a minimal batchUpdate (add + delete a test tab).
// Remove this file once the write issue is resolved.
//
// Usage: GET /api/debug/sheets-test
// Returns: step-by-step results with full Google API responses for each call.

import { createClient } from "@/lib/supabase/server";
import { getValidToken } from "@/lib/google/auth";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const CPS_PAYROLL_SHEET_ID = "1ZgxSO5cyaX4VtK2hM5efgliqXkr6k3uScn65WEPxm4M";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const results: Record<string, unknown> = {};

  try {
    // ── Step 1: get a valid token ──────────────────────────────
    let token: string;
    try {
      token = await getValidToken(user.id);
      results.token = "obtained";
    } catch (err) {
      results.token_error = err instanceof Error ? err.message : String(err);
      return Response.json(results, { status: 200 });
    }

    // ── Step 2: check token scopes ────────────────────────────
    try {
      const infoRes = await fetch(`${TOKEN_INFO_URL}?access_token=${token}`);
      const infoBody = (await infoRes.json()) as Record<string, unknown>;
      results.token_scopes = infoBody.scope ?? infoBody.error ?? infoBody;
    } catch (err) {
      results.token_info_error = err instanceof Error ? err.message : String(err);
    }

    // ── Step 3: read the spreadsheet metadata ─────────────────
    const readRes = await fetch(
      `${SHEETS_API}/${CPS_PAYROLL_SHEET_ID}?fields=properties.title,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const readText = await readRes.text();
    results.read_metadata = {
      status: readRes.status,
      body: safeJson(readText),
    };
    if (!readRes.ok) {
      return Response.json(results, { status: 200 });
    }

    // ── Step 4: attempt minimal batchUpdate (add test tab) ────
    const addRes = await fetch(`${SHEETS_API}/${CPS_PAYROLL_SHEET_ID}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: "_bruce_debug_test_" } } }],
      }),
    });
    const addText = await addRes.text();
    results.add_tab = { status: addRes.status, body: safeJson(addText) };

    // ── Step 5: if add succeeded, delete the test tab ─────────
    if (addRes.ok) {
      const addData = safeJson(addText) as Record<string, unknown>;
      const replies = (addData.replies as Array<{ addSheet?: { properties?: { sheetId?: number } } }>) ?? [];
      const testSheetId = replies[0]?.addSheet?.properties?.sheetId;
      if (testSheetId !== undefined) {
        const delRes = await fetch(`${SHEETS_API}/${CPS_PAYROLL_SHEET_ID}:batchUpdate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requests: [{ deleteSheet: { sheetId: testSheetId } }],
          }),
        });
        results.delete_test_tab = { status: delRes.status, cleaned_up: delRes.ok };
      }
    }

    return Response.json(results, { status: 200 });
  } catch (err) {
    results.unexpected_error = err instanceof Error ? err.message : String(err);
    return Response.json(results, { status: 200 });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
