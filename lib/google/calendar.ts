// ============================================================
// Bruce — Google Calendar client
// Reads and writes the shared Johnson family calendar.
// Uses a single shared service account (johnson2016family@gmail.com)
// via a stored refresh token — NOT per-member OAuth.
// All functions are server-side only.
// ============================================================

import type { CalendarEvent } from "@/lib/types";
import { resolveGuestEmails } from "@/lib/google/household-members";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// ============================================================
// Token management — exchanges the long-lived refresh token for
// a short-lived access token on each request. No caching needed
// because Vercel Fluid Compute reuses instances, but the token
// overhead is negligible (~100ms) vs the risk of stale state.
// ============================================================

async function getCalendarAccessToken(): Promise<string> {
  const refreshToken = process.env.FAMILY_CALENDAR_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("FAMILY_CALENDAR_REFRESH_TOKEN is not configured.");
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendar token refresh failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return data.access_token;
}

function calendarId(): string {
  return process.env.FAMILY_CALENDAR_ID ?? "primary";
}

// ============================================================
// Read
// ============================================================

export async function getUpcomingEvents(
  maxResults = 10,
  daysAhead = 30
): Promise<CalendarEvent[]> {
  const token = await getCalendarAccessToken();

  const now = new Date().toISOString();
  const future = new Date(
    Date.now() + daysAhead * 24 * 60 * 60 * 1000
  ).toISOString();

  const url = new URL(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId())}/events`
  );
  url.searchParams.set("timeMin", now);
  url.searchParams.set("timeMax", future);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set(
    "fields",
    "items(id,summary,description,start,end,attendees,htmlLink)"
  );

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendar events fetch failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      attendees?: Array<{ email: string; displayName?: string }>;
      htmlLink?: string;
    }>;
  };

  return (data.items ?? []).map((item) => ({
    id: item.id,
    title: item.summary ?? "(no title)",
    start: item.start?.dateTime ?? item.start?.date ?? "",
    end: item.end?.dateTime ?? item.end?.date ?? "",
    description: item.description ?? "",
    guests: (item.attendees ?? []).map((a) => a.displayName ?? a.email),
    htmlLink: item.htmlLink ?? "",
  }));
}

// ============================================================
// Write — create / update / delete
// These are gated behind Bruce's confirmation rule (medium stakes).
// Bruce always asks before calling any of these tools.
// ============================================================

export interface CreateEventParams {
  title: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM 24-hour; omit for all-day
  duration_minutes?: number; // default 60 for timed events
  description?: string;
  guest_names?: string[]; // household member names → resolved to emails
}

export async function createCalendarEvent(
  params: CreateEventParams
): Promise<CalendarEvent> {
  const token = await getCalendarAccessToken();

  let startObj: Record<string, string>;
  let endObj: Record<string, string>;

  if (params.time) {
    const startDt = new Date(`${params.date}T${params.time}:00`);
    const duration = (params.duration_minutes ?? 60) * 60 * 1000;
    const endDt = new Date(startDt.getTime() + duration);
    // Use local dateTime strings so Google interprets them in the
    // calendar's configured timezone rather than forcing UTC.
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    const tz = process.env.FAMILY_CALENDAR_TIMEZONE ?? "America/Chicago";
    startObj = { dateTime: fmt(startDt), timeZone: tz };
    endObj = { dateTime: fmt(endDt), timeZone: tz };
  } else {
    startObj = { date: params.date };
    endObj = { date: params.date };
  }

  const guestEmails = params.guest_names?.length
    ? resolveGuestEmails(params.guest_names)
    : [];

  const body: Record<string, unknown> = {
    summary: params.title,
    start: startObj,
    end: endObj,
  };
  if (params.description) body.description = params.description;
  if (guestEmails.length) {
    body.attendees = guestEmails.map((email) => ({ email }));
  }

  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId())}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendar create failed: ${res.status} — ${err}`);
  }

  return parseEventResponse(await res.json());
}

export interface UpdateEventParams {
  title?: string;
  date?: string;
  time?: string;
  duration_minutes?: number;
  description?: string;
  guest_names?: string[]; // replaces entire guest list when provided
}

export async function updateCalendarEvent(
  eventId: string,
  params: UpdateEventParams
): Promise<CalendarEvent> {
  const token = await getCalendarAccessToken();
  const cid = calendarId();

  // Fetch current event to patch on top of
  const getRes = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!getRes.ok) {
    throw new Error(`Event ${eventId} not found (${getRes.status})`);
  }
  const existing = (await getRes.json()) as {
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
  };

  const patch: Record<string, unknown> = {};
  if (params.title !== undefined) patch.summary = params.title;
  if (params.description !== undefined) patch.description = params.description;

  if (params.date || params.time || params.duration_minutes) {
    const date =
      params.date ??
      (existing.start.dateTime?.substring(0, 10) ?? existing.start.date ?? "");
    const existingTime = existing.start.dateTime
      ? existing.start.dateTime.substring(11, 16)
      : null;
    const time = params.time ?? existingTime;

    if (time) {
      const startDt = new Date(`${date}T${time}:00`);
      let durationMs: number;
      if (params.duration_minutes) {
        durationMs = params.duration_minutes * 60 * 1000;
      } else if (existing.start.dateTime && existing.end.dateTime) {
        durationMs =
          new Date(existing.end.dateTime).getTime() -
          new Date(existing.start.dateTime).getTime();
      } else {
        durationMs = 60 * 60 * 1000;
      }
      const endDt = new Date(startDt.getTime() + durationMs);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
      const tz = process.env.FAMILY_CALENDAR_TIMEZONE ?? "America/Chicago";
      patch.start = { dateTime: fmt(startDt), timeZone: tz };
      patch.end = { dateTime: fmt(endDt), timeZone: tz };
    } else {
      patch.start = { date };
      patch.end = { date };
    }
  }

  if (params.guest_names !== undefined) {
    const emails = resolveGuestEmails(params.guest_names);
    patch.attendees = emails.map((email) => ({ email }));
  }

  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Calendar update failed: ${res.status} — ${err}`);
  }

  return parseEventResponse(await res.json());
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const token = await getCalendarAccessToken();
  const cid = calendarId();

  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  // 404 means already deleted — treat as success
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`Calendar delete failed: ${res.status} — ${err}`);
  }
}

// ============================================================
// Helpers
// ============================================================

function parseEventResponse(event: Record<string, unknown>): CalendarEvent {
  const attendees = (event.attendees as Array<{ email: string; displayName?: string }>) ?? [];
  const start = event.start as { dateTime?: string; date?: string };
  const end = event.end as { dateTime?: string; date?: string };
  return {
    id: event.id as string,
    title: (event.summary as string) ?? "",
    start: start?.dateTime ?? start?.date ?? "",
    end: end?.dateTime ?? end?.date ?? "",
    description: (event.description as string) ?? "",
    guests: attendees.map((a) => a.displayName ?? a.email),
    htmlLink: (event.htmlLink as string) ?? "",
  };
}
