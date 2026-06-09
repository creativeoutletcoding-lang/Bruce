// Browser action runner — Bruce's server-side control of the shared browser.
//
// Connects directly to the EXISTING Browserbase session over CDP with
// playwright-core (`chromium.connectOverCDP`). We do NOT use Stagehand's
// `browserbaseSessionID` reconnect path: in v3.5 that path is unreliable — it
// fails to locate the connectUrl on the retrieved session object. Connecting
// over CDP with the signed WebSocket URL (captured at session-create time and
// stored in browser_sessions.connect_url) keeps Bruce inside the same session
// the household member watches in the Live View iframe — Bruce navigates, the
// human sees it move; the human clicks, Bruce's next action sees the new DOM.
//
// `browser.close()` only tears down our CDP connection — the Browserbase session
// itself keeps running (keepAlive), so the Live View and the next action survive.

export type BrowserAction = "navigate" | "act" | "extract" | "screenshot";

export interface BrowserActionResult {
  success: boolean;
  result?: string;
  currentUrl: string;
  error?: string;
}

export async function performBrowserAction(
  sessionId: string,
  connectUrl: string | null,
  action: BrowserAction,
  params: { url?: string; instruction?: string }
): Promise<BrowserActionResult> {
  // Dynamic import keeps playwright-core out of any module graph evaluated on a
  // serverless cold start before the browser tool is actually used.
  const { chromium } = await import("playwright-core");

  // Prefer the signed connectUrl captured at create time; fall back to the
  // constructable Browserbase CDP endpoint for older rows without one.
  const wsUrl =
    connectUrl ??
    `wss://connect.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}&sessionId=${sessionId}`;

  const browser = await chromium.connectOverCDP(wsUrl);

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    let result: string | undefined;

    switch (action) {
      case "navigate": {
        if (!params.url) throw new Error("URL required for navigate");
        await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 20000 });
        result = `Navigated to ${params.url}`;
        break;
      }
      case "screenshot": {
        const buffer = await page.screenshot({ type: "jpeg", quality: 80 });
        // Base64 data URL — no external upload needed for the initial ship.
        result = `data:image/jpeg;base64,${buffer.toString("base64")}`;
        break;
      }
      case "act":
      case "extract": {
        // Stubbed for now (these required Stagehand's LLM-driven act/extract).
        // Return a clear message so Bruce can respond gracefully instead of failing.
        result = `Browser action '${action}' is not yet supported. Navigation and screenshots are available.`;
        break;
      }
    }

    return { success: true, result, currentUrl: page.url() };
  } catch (error) {
    console.error("STAGEHAND_ERROR:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Browser action failed",
      // CDP may have failed before a page existed — best-effort current URL.
      currentUrl: browser.contexts()[0]?.pages()[0]?.url() ?? "about:blank",
    };
  } finally {
    // Close the CDP connection only — does NOT terminate the Browserbase session.
    await browser.close().catch(() => {});
  }
}
