// ============================================================
// Bruce — Gmail client
// Per-user OAuth tokens stored in the users table.
// All functions are server-side only.
// Supports read and search only (gmail.readonly scope).
// ============================================================

import { createServiceRoleClient } from "@/lib/supabase/server";

const GMAIL_API = "https://www.googleapis.com/gmail/v1/users/me";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ============================================================
// Token management — identical pattern to drive.ts
// ============================================================

async function getValidToken(userId: string): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from("users")
    .select("google_access_token, google_refresh_token, google_token_expires_at, email")
    .eq("id", userId)
    .single();

  if (!user?.google_refresh_token) {
    throw new Error(
      "Gmail authorization required. Please sign out and sign back in to grant Gmail access."
    );
  }

  const expiresAt = user.google_token_expires_at
    ? new Date(user.google_token_expires_at)
    : null;
  const now = Date.now();

  if (
    user.google_access_token &&
    expiresAt &&
    expiresAt.getTime() - now > REFRESH_BUFFER_MS
  ) {
    return user.google_access_token;
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: user.google_refresh_token,
      grant_type:    "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(
      `Gmail token refresh failed (${res.status}). Please sign out and sign back in. Detail: ${err}`
    );
  }

  const tokenData = (await res.json()) as { access_token: string; expires_in: number };
  const newExpiresAt = new Date(now + tokenData.expires_in * 1000).toISOString();

  await supabase
    .from("users")
    .update({
      google_access_token:    tokenData.access_token,
      google_token_expires_at: newExpiresAt,
    })
    .eq("id", userId);

  return tokenData.access_token;
}

// ============================================================
// Types
// ============================================================

export interface GmailMessageHeader {
  from:    string;
  to:      string;
  subject: string;
  date:    string;
}

export interface GmailMessage {
  id:       string;
  threadId: string;
  snippet:  string;
  headers:  GmailMessageHeader;
  body:     string;
  labelIds: string[];
}

export interface GmailThread {
  id:       string;
  snippet:  string;
  messages: GmailMessage[];
}

export interface GmailThreadSummary {
  id:      string;
  snippet: string;
  subject: string;
  from:    string;
  date:    string;
  unread:  boolean;
}

// ============================================================
// Helpers
// ============================================================

type RawHeader = { name: string; value: string };

function extractHeaders(headers: RawHeader[]): GmailMessageHeader {
  const get = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  return {
    from:    get("From"),
    to:      get("To"),
    subject: get("Subject"),
    date:    get("Date"),
  };
}

function decodeBody(payload: RawPayload): string {
  // Single-part message
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  // Multipart — prefer text/plain, fall back to text/html
  if (payload.parts) {
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) {
      return Buffer.from(plain.body.data, "base64url").toString("utf-8");
    }
    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) {
      // Strip tags minimally for plain-text display
      return Buffer.from(html.body.data, "base64url")
        .toString("utf-8")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    // Recurse into nested multipart parts
    for (const part of payload.parts) {
      const nested = decodeBody(part);
      if (nested) return nested;
    }
  }
  return "";
}

type RawPayload = {
  mimeType?: string;
  headers?: RawHeader[];
  body?: { data?: string };
  parts?: RawPayload[];
};

type RawMessage = {
  id:       string;
  threadId: string;
  snippet:  string;
  labelIds: string[];
  payload:  RawPayload;
};

function parseMessage(raw: RawMessage): GmailMessage {
  const headers = extractHeaders(raw.payload.headers ?? []);
  return {
    id:       raw.id,
    threadId: raw.threadId,
    snippet:  raw.snippet ?? "",
    headers,
    body:     decodeBody(raw.payload),
    labelIds: raw.labelIds ?? [],
  };
}

// RFC 2822 message builder, base64url-encoded for the Gmail API
function buildRawMessage({
  from,
  to,
  subject,
  body,
  inReplyTo,
  references,
  threadSubject,
}: {
  from?:          string;
  to:             string;
  subject:        string;
  body:           string;
  inReplyTo?:     string;
  references?:    string;
  threadSubject?: string;
}): string {
  const finalSubject = threadSubject ?? subject;
  const lines: string[] = [];
  if (from) lines.push(`From: ${from}`);
  lines.push(`To: ${to}`);
  lines.push(`Subject: ${finalSubject}`);
  lines.push("MIME-Version: 1.0");
  lines.push("Content-Type: text/plain; charset=UTF-8");
  if (inReplyTo)  lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("");
  lines.push(body);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// ============================================================
// Read
// ============================================================

export async function listInboxThreads(
  userId:     string,
  maxResults  = 20,
  query       = ""
): Promise<GmailThreadSummary[]> {
  const token = await getValidToken(userId);

  const url = new URL(`${GMAIL_API}/threads`);
  url.searchParams.set("labelIds",   "INBOX");
  url.searchParams.set("maxResults", String(maxResults));
  if (query) url.searchParams.set("q", query);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail listThreads failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as { threads?: { id: string; snippet: string }[] };
  const threads = data.threads ?? [];

  // Fetch the first message of each thread in parallel for header details
  const summaries = await Promise.all(
    threads.map(async (t) => {
      try {
        const tRes = await fetch(`${GMAIL_API}/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!tRes.ok) return { id: t.id, snippet: t.snippet, subject: "", from: "", date: "", unread: false };
        const tData = (await tRes.json()) as {
          id: string;
          messages: Array<{ labelIds: string[]; payload: { headers: RawHeader[] } }>;
        };
        const first = tData.messages?.[0];
        const headers = extractHeaders(first?.payload?.headers ?? []);
        const unread = (first?.labelIds ?? []).includes("UNREAD");
        return { id: t.id, snippet: t.snippet, subject: headers.subject, from: headers.from, date: headers.date, unread };
      } catch {
        return { id: t.id, snippet: t.snippet, subject: "", from: "", date: "", unread: false };
      }
    })
  );

  return summaries;
}

export async function getThreadDetail(
  userId:   string,
  threadId: string
): Promise<GmailThread> {
  const token = await getValidToken(userId);

  const res = await fetch(`${GMAIL_API}/threads/${threadId}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail getThread failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as {
    id:       string;
    snippet:  string;
    messages: RawMessage[];
  };

  return {
    id:       data.id,
    snippet:  data.snippet ?? "",
    messages: (data.messages ?? []).map(parseMessage),
  };
}

export async function searchMessages(
  userId:     string,
  query:      string,
  maxResults  = 10
): Promise<GmailThreadSummary[]> {
  return listInboxThreads(userId, maxResults, query);
}

// ============================================================
// Send
// ============================================================

export async function sendEmail(
  userId:     string,
  to:         string,
  subject:    string,
  body:       string,
  fromAlias?: string
): Promise<{ messageId: string; threadId: string }> {
  const token = await getValidToken(userId);

  const raw = buildRawMessage({ from: fromAlias, to, subject, body });

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as { id: string; threadId: string };
  return { messageId: data.id, threadId: data.threadId };
}

export async function replyToThread(
  userId:     string,
  threadId:   string,
  body:       string,
  fromAlias?: string
): Promise<{ messageId: string; threadId: string }> {
  const token = await getValidToken(userId);

  // Fetch the thread to extract reply headers from the last message
  const thread = await getThreadDetail(userId, threadId);
  const lastMsg = thread.messages[thread.messages.length - 1];
  const { from, subject } = lastMsg.headers;

  // Build In-Reply-To and References from the last message's Message-ID header
  const rawRes = await fetch(`${GMAIL_API}/messages/${lastMsg.id}?format=metadata&metadataHeaders=Message-Id&metadataHeaders=References`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let inReplyTo = "";
  let references = "";
  if (rawRes.ok) {
    const rawData = (await rawRes.json()) as { payload: { headers: RawHeader[] } };
    const msgId = rawData.payload.headers.find((h) => h.name.toLowerCase() === "message-id")?.value ?? "";
    const existingRefs = rawData.payload.headers.find((h) => h.name.toLowerCase() === "references")?.value ?? "";
    inReplyTo  = msgId;
    references = existingRefs ? `${existingRefs} ${msgId}` : msgId;
  }

  // Reply-to: whoever sent the last message (not us)
  const replyTo = from;
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

  const raw = buildRawMessage({
    from:           fromAlias,
    to:             replyTo,
    subject:        replySubject,
    body,
    inReplyTo,
    references,
  });

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw, threadId }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail reply failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as { id: string; threadId: string };
  return { messageId: data.id, threadId: data.threadId };
}

// ============================================================
// Modify / Delete
// ============================================================

export async function archiveMessage(
  userId:    string,
  messageId: string
): Promise<void> {
  const token = await getValidToken(userId);

  const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail archive failed: ${res.status} — ${err}`);
  }
}

export async function deleteMessage(
  userId:    string,
  messageId: string
): Promise<void> {
  const token = await getValidToken(userId);

  // Move to Trash (soft delete) — matches codebase preference for reversible deletes
  const res = await fetch(`${GMAIL_API}/messages/${messageId}/trash`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail trash failed: ${res.status} — ${err}`);
  }
}
