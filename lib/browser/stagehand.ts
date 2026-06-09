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
  /** Base64 data URL of the page screenshot (set for navigate + screenshot). */
  screenshotData?: string;
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

  // A failed CDP connect means the underlying Browserbase session is dead or
  // expired. Mark it inactive so it's never re-selected, and signal the caller
  // (via the SESSION_DEAD sentinel error) to spin up a fresh session and retry.
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>>;
  try {
    browser = await chromium.connectOverCDP(wsUrl);
  } catch (error) {
    console.error("STAGEHAND_ERROR: CDP connect failed:", error);
    const { markSessionInactive } = await import("@/lib/browser/browserbase");
    await markSessionInactive(sessionId).catch(() => {});
    throw new Error("SESSION_DEAD");
  }

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    let result: string | undefined;
    let screenshotData: string | undefined;

    switch (action) {
      case "navigate": {
        if (!params.url) throw new Error("URL required for navigate");
        await page.goto(params.url, { waitUntil: "domcontentloaded", timeout: 20000 });
        result = `Navigated to ${params.url}`;
        // Auto-screenshot so Bruce always sees what he landed on. Best-effort —
        // the navigation already succeeded, so don't fail it if capture throws.
        try {
          const buffer = await page.screenshot({ type: "jpeg", quality: 80 });
          screenshotData = `data:image/jpeg;base64,${buffer.toString("base64")}`;
        } catch { /* screenshot is best-effort */ }
        break;
      }
      case "screenshot": {
        const buffer = await page.screenshot({ type: "jpeg", quality: 80 });
        screenshotData = `data:image/jpeg;base64,${buffer.toString("base64")}`;
        result = "Captured a screenshot of the current page.";
        break;
      }
      case "extract": {
        const title = await page.title();
        const text = await page.evaluate(() => document.body.innerText);
        // Trim to ~3000 chars so it fits cleanly in the tool result.
        const trimmed = text.slice(0, 3000);
        result = `Page title: ${title}\n\nContent:\n${trimmed}`;
        break;
      }
      case "act": {
        // Direct LLM-driven interaction isn't wired up yet (it relied on Stagehand).
        result = `Direct page interaction isn't available yet — try asking me to navigate to a specific URL instead.`;
        break;
      }
    }

    return { success: true, result, currentUrl: page.url(), screenshotData };
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
