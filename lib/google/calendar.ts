// ============================================================
// Bruce — Google Calendar client
// Reads and writes the shared Johnson family calendar.
// Uses a single shared service account (johnson2016family@gmail.com)
// via a stored refresh token — NOT per-member OAuth.
// All functions are server-side only.
//
// Skylight profile assignment:
//   Each household member has a sub-calendar under johnson2016family@gmail.com.
//   The sub-calendar ID doubles as an attendee "email" in the Google Calendar API.
//   To assign an event to one person: create on their sub-calendar.
//   To assign to multiple: create on the first person's sub-calendar,
//   add remaining sub-calendar IDs as attendees. Skylight surfaces the
//   event under every profile that is organizer or attendee.
// ============================================================

import type { CalendarEvent } from "@/lib/types";
import {
  HOUSEHOLD_CALENDAR_IDS,
  allCalendarIds,
  resolveCalendarIds,
} from "@/lib/google/household-members";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// ============================================================
// Token management
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

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ============================================================
// Read
// Queries every member's sub-calendar in parallel and deduplicates
// by event ID so shared events (organizer + attendee copies) appear once.
// Each returned event carries its source calendarId so update/delete
// can target the right calendar without a search.
// ============================================================

type RawEvent = {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  organizer?: { email: string };
  htmlLink?: string;
};

async function fetchCalendarEvents(
  token: string,
  cid: string,
  maxResults: number,
  daysAhead: number
): Promise<CalendarEvent[]> {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(cid)}/events`);
  url.searchParams.set("timeMin", now);
  url.searchParams.set("timeMax", future);
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("fields", "items(id,summary,description,start,end,attendees,organizer,htmlLink)");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return []; // silently skip calendars that 404 or 403

  const data = (await res.json()) as { items?: RawEvent[] };
  return (data.items ?? []).map((item) => parseRawEvent(item, cid));
}

export async function getUpcomingEvents(
  maxResults = 10,
  daysAhead = 30
): Promise<CalendarEvent[]> {
  const token = await getCalendarAccessToken();

  // Query all per-person sub-calendars plus the primary/family calendar.
  const primary = process.env.FAMILY_CALENDAR_ID ?? "primary";
  const calIds = [...new Set([primary, ...allCalendarIds()])];

  const results = await Promise.allSettled(
    calIds.map((cid) => fetchCalendarEvents(token, cid, maxResults, daysAhead))
  );

  // Merge, deduplicate by event ID (same event shows on organizer's and
  // each attendee's calendar — keep the first occurrence which is the
  // organizer's copy and carries the correct calendarId).
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const ev of result.value) {
        if (!seen.has(ev.id)) {
          seen.add(ev.id);
          events.push(ev);
        }
      }
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  return events.slice(0, maxResults);
}

// ============================================================
// Write
// Bruce's confirmation rule (medium stakes) is enforced by the
// system prompt — these functions are only called after the user
// explicitly says yes.
// ============================================================

export interface CreateEventParams {
  title: string;
  date: string;           // YYYY-MM-DD
  time?: string;          // HH:MM 24-hour; omit for all-day
  duration_minutes?: number;
  description?: string;
  guest_names?: string[]; // household member names resolved to sub-calendar IDs
}

export async function createCalendarEvent(params: CreateEventParams): Promise<CalendarEvent> {
  const token = await getCalendarAccessToken();

  const memberIds = params.guest_names?.length
    ? resolveCalendarIds(params.guest_names)
    : [];

  // Event organizer calendar: first named member's sub-calendar, or primary if unspecified.
  const targetCalId = memberIds.length > 0
    ? memberIds[0]
    : (process.env.FAMILY_CALENDAR_ID ?? "primary");

  // Remaining members become attendees (their sub-calendar IDs act as email addresses).
  const attendeeIds = memberIds.slice(1);

  let startObj: Record<string, string>;
  let endObj: Record<string, string>;

  if (params.time) {
    const startDt = new Date(`${params.date}T${params.time}:00`);
    const duration = (params.duration_minutes ?? 60) * 60 * 1000;
    const endDt = new Date(startDt.getTime() + duration);
    const tz = process.env.FAMILY_CALENDAR_TIMEZONE ?? "America/Chicago";
    startObj = { dateTime: fmtLocalDt(startDt), timeZone: tz };
    endObj   = { dateTime: fmtLocalDt(endDt),   timeZone: tz };
  } else {
    startObj = { date: params.date };
    endObj   = { date: params.date };
  }

  const body: Record<string, unknown> = {
    summary: params.title,
    start: startObj,
    end: endObj,
  };
  if (params.description) body.description = params.description;
  if (attendeeIds.length > 0) {
    body.attendees = attendeeIds.map((id) => ({ email: id }));
  }

  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(targetCalId)}/events`,
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

  return parseRawEvent(await res.json() as RawEvent, targetCalId);
}

export interface UpdateEventParams {
  calendar_id: string;    // from get_upcoming_events — which sub-calendar holds the event
  title?: string;
  date?: string;
  time?: string;
  duration_minutes?: number;
  description?: string;
  guest_names?: string[]; // when provided, replaces the full attendee list
}

export async function updateCalendarEvent(
  eventId: string,
  params: UpdateEventParams
): Promise<CalendarEvent> {
  const token = await getCalendarAccessToken();
  const cid = params.calendar_id;

  // Fetch current event so we can compute defaults for unchanged fields.
  const getRes = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(cid)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!getRes.ok) {
    throw new Error(`Event ${eventId} not found on calendar ${cid} (${getRes.status})`);
  }
  const existing = (await getRes.json()) as RawEvent & {
    start: { dateTime?: string; date?: string };
    end:   { dateTime?: string; date?: string };
  };

  const patch: Record<string, unknown> = {};
  if (params.title       !== undefined) patch.summary     = params.title;
  if (params.description !== undefined) patch.description = params.description;

  if (params.date || params.time || params.duration_minutes) {
    const date = params.date
      ?? (existing.start.dateTime?.substring(0, 10) ?? existing.start.date ?? "");
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
      const tz = process.env.FAMILY_CALENDAR_TIMEZONE ?? "America/Chicago";
      patch.start = { dateTime: fmtLocalDt(startDt), timeZone: tz };
      patch.end   = { dateTime: fmtLocalDt(endDt),   timeZone: tz };
    } else {
      patch.start = { date };
      patch.end   = { date };
    }
  }

  if (params.guest_names !== undefined) {
    // Rebuild attendee list: members after the first (the organizer calendar is unchanged).
    const memberIds = resolveCalendarIds(params.guest_names);
    const attendeeIds = memberIds.filter((id) => id !== cid);
    patch.attendees = attendeeIds.map((id) => ({ email: id }));
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

  return parseRawEvent(await res.json() as RawEvent, cid);
}

export async function deleteCalendarEvent(
  eventId: string,
  calId: string
): Promise<void> {
  const token = await getCalendarAccessToken();

  const res = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  // 404 = already deleted — treat as success.
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`Calendar delete failed: ${res.status} — ${err}`);
  }
}

// ============================================================
// Helpers
// ============================================================

function fmtLocalDt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Reverse-lookup: given a sub-calendar ID, return the member name (for display).
function calIdToName(id: string): string | undefined {
  return Object.entries(HOUSEHOLD_CALENDAR_IDS).find(([, v]) => v === id)?.[0];
}

function parseRawEvent(item: RawEvent, sourceCid: string): CalendarEvent {
  const attendeeIds = (item.attendees ?? []).map((a) => a.email);
  // Collect all assigned members: organizer (sourceCid) + attendees.
  const allAssigned = [...new Set([sourceCid, ...attendeeIds])];
  const guestNames = allAssigned
    .map((id) => calIdToName(id) ?? id)
    .filter(Boolean);

  return {
    id: item.id,
    calendarId: sourceCid,
    title: item.summary ?? "(no title)",
    start: item.start?.dateTime ?? item.start?.date ?? "",
    end:   item.end?.dateTime   ?? item.end?.date   ?? "",
    description: item.description ?? "",
    guests: guestNames,
    htmlLink: item.htmlLink ?? "",
  };
}
