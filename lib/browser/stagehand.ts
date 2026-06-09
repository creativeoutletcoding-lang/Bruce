// Stagehand action runner — Bruce's server-side control of the shared browser.
//
// Stagehand v3 (@browserbasehq/stagehand 3.x). The critical detail: we connect
// to an EXISTING Browserbase session by id via `browserbaseSessionID`, rather
// than letting Stagehand create a fresh one. That is what keeps Bruce inside the
// same session the household member is watching in the Live View iframe — Bruce
// navigates, the human sees it move; the human clicks, Bruce's next action sees
// the updated DOM.
//
// v3 API notes (confirmed from installed dist/esm/lib/v3 types):
//   - constructor takes V3Options: { env, apiKey, projectId, browserbaseSessionID,
//     keepAlive, model }. The Stagehand export is an alias for the V3 class.
//   - there is no `stagehand.page`; the active Playwright-like Page comes from
//     `stagehand.context.activePage()` (or `context.newPage()` if none yet).
//   - act takes a string instruction: `act(instruction)`, not `act({ action })`.
//   - extract takes positional `(instruction, schema)`, returning the inferred shape.
//   - page.goto uses `{ waitUntil, timeoutMs }` (note: timeoutMs, not timeout).
//   - the Browserbase session persists after `stagehand.close()` — close only
//     tears down Stagehand's CDP connection, not the session.

import { z } from "zod";

export type BrowserAction = "navigate" | "act" | "extract" | "screenshot";

export interface BrowserActionResult {
  success: boolean;
  result?: string;
  currentUrl: string;
  error?: string;
}

export async function performBrowserAction(
  sessionId: string,
  action: BrowserAction,
  params: { url?: string; instruction?: string }
): Promise<BrowserActionResult> {
  // Dynamic import keeps the (large) Stagehand dependency out of any module
  // graph that might be evaluated on a serverless cold start before it's needed.
  const { Stagehand } = await import("@browserbasehq/stagehand");

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    disablePino: true,
    // Direct mode: resolve the model locally via our Anthropic key through the
    // AI SDK provider, instead of routing inference through Stagehand's hosted
    // API (which has its own model allow-list that returns 400 for models it
    // doesn't recognize). navigate doesn't use the model at all; act/extract use
    // our key directly. Requires the provider/model format below.
    disableAPI: true,
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    browserbaseSessionID: sessionId, // reconnect to the existing shared session
    keepAlive: true,
    model: {
      modelName: "anthropic/claude-sonnet-4-20250514",
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
  });

  await stagehand.init();

  // Reconnected sessions normally already have an active page; create one if not.
  let page = stagehand.context.activePage();
  if (!page) page = await stagehand.context.newPage();

  try {
    let result: string | undefined;

    switch (action) {
      case "navigate": {
        if (!params.url) throw new Error("URL required for navigate");
        await page.goto(params.url, { waitUntil: "domcontentloaded", timeoutMs: 20000 });
        result = `Navigated to ${params.url}`;
        break;
      }
      case "act": {
        if (!params.instruction) throw new Error("Instruction required for act");
        await stagehand.act(params.instruction);
        result = `Performed: ${params.instruction}`;
        break;
      }
      case "extract": {
        if (!params.instruction) throw new Error("Instruction required for extract");
        const extracted = await stagehand.extract(
          params.instruction,
          z.object({ content: z.string() })
        );
        result = extracted.content;
        break;
      }
      case "screenshot": {
        const buffer = await page.screenshot({ type: "jpeg", quality: 80 });
        // Base64 data URL — no external upload needed for the initial ship.
        result = `data:image/jpeg;base64,${Buffer.from(buffer).toString("base64")}`;
        break;
      }
    }

    return { success: true, result, currentUrl: page.url() };
  } catch (error) {
    console.error("STAGEHAND_ERROR:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Browser action failed",
      currentUrl: page.url(),
    };
  } finally {
    // Always disconnect Stagehand. The Browserbase session itself keeps running
    // (keepAlive) so the human's Live View and the next tool call stay live.
    await stagehand.close().catch(() => {});
  }
}
