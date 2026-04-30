#!/usr/bin/env node
// ============================================================
// One-time script: get a refresh token for the family calendar
// account (johnson2016family@gmail.com).
//
// Prerequisites:
//   1. Add http://localhost:9999 as an Authorized Redirect URI in
//      Google Cloud Console → Credentials → your OAuth 2.0 Client ID.
//   2. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be in .env.local
//      (they are already used by the Drive integration).
//
// Run (from the project root):
//   node --env-file=.env.local scripts/get-calendar-token.mjs
//
// Sign in as johnson2016family@gmail.com when the browser opens.
// The refresh token will be printed to the console.
// ============================================================

import { createServer } from "http";
import { exec } from "child_process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\n❌  GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET not found.\n" +
    "    Make sure you are running from the project root:\n\n" +
    "      node --env-file=.env.local scripts/get-calendar-token.mjs\n"
  );
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:9999";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const PORT = 9999;

// ── Build the auth URL ────────────────────────────────────────────────────────

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent"); // forces refresh token issuance

// ── Open browser ─────────────────────────────────────────────────────────────

console.log("\n=== Bruce — Family Calendar Token Generator ===\n");
console.log("Sign in as johnson2016family@gmail.com when the browser opens.\n");
console.log("If your browser does not open automatically, visit:\n");
console.log("  " + authUrl.toString() + "\n");

const openCmd =
  process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
    ? "start"
    : "xdg-open";

exec(`${openCmd} "${authUrl.toString()}"`, (err) => {
  if (err) {
    // Non-fatal — user can open manually from the URL printed above.
  }
});

// ── Local callback server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // Only handle the root callback; ignore /favicon.ico etc.
  const reqUrl = new URL(req.url, `http://localhost:${PORT}`);

  const code = reqUrl.searchParams.get("code");
  const error = reqUrl.searchParams.get("error");

  if (!code && !error) {
    res.writeHead(204).end();
    return;
  }

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      `<h2 style="font-family:sans-serif;color:#c00">OAuth error: ${error}</h2>
       <p style="font-family:sans-serif">Check the console.</p>`
    );
    console.error("\n❌  OAuth error:", error);
    server.close(() => process.exit(1));
    return;
  }

  // Exchange authorization code for tokens
  let tokens;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    tokens = await tokenRes.json();

    if (!tokenRes.ok) {
      res.writeHead(200, { "Content-Type": "text/html" }).end(
        `<h2 style="font-family:sans-serif;color:#c00">Token exchange failed</h2>
         <pre style="font-family:monospace">${JSON.stringify(tokens, null, 2)}</pre>`
      );
      console.error("\n❌  Token exchange failed:", tokens);
      server.close(() => process.exit(1));
      return;
    }
  } catch (err) {
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      `<h2 style="font-family:sans-serif;color:#c00">Fetch error</h2>
       <pre style="font-family:monospace">${err}</pre>`
    );
    console.error("\n❌  Fetch error:", err);
    server.close(() => process.exit(1));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" }).end(
    `<h2 style="font-family:sans-serif;color:#0a0">✓ Authorized</h2>
     <p style="font-family:sans-serif">You can close this tab. Your refresh token has been printed to the console.</p>`
  );

  console.log("\n✅  Authorization successful!\n");

  if (tokens.refresh_token) {
    console.log("Add this line to .env.local:");
    console.log(`\n  FAMILY_CALENDAR_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } else {
    console.warn(
      "⚠️   No refresh_token in response.\n" +
      "     This usually means johnson2016family@gmail.com already authorized this app\n" +
      "     and Google only issues a refresh token on the first consent.\n\n" +
      "     Fix: visit https://myaccount.google.com/permissions, revoke access for\n" +
      "     your OAuth app, then run this script again.\n"
    );
  }

  server.close(() => process.exit(0));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Listening for OAuth callback on http://localhost:${PORT} ...\n`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n❌  Port ${PORT} is already in use. Kill whatever is running on it and try again.\n`
    );
  } else {
    console.error("\n❌  Server error:", err);
  }
  process.exit(1);
});
