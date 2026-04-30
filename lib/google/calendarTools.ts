// ============================================================
// Bruce — Anthropic tool definitions + executor for Google Calendar.
// Imported by /api/chat and /api/family/chat routes.
//
// Auth is handled entirely by the Google Calendar MCP server —
// no refresh token or per-request OAuth is needed here.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import {
  HOUSEHOLD_CALENDAR_IDS,
  allCalendarIds,
  resolveCalendarIds,
} from "@/lib/google/household-members";

const MCP_URL = "https://calendarmcp.googleapis.com/mcp/v1";

// ── MCP HTTP transport ────────────────────────────────────────────────────────
// Sends a JSON-RPC 2.0 tool/call to the Google Calendar MCP server and returns
// the text content of the result. The server is pre-authenticated — no auth
// header is added here.

async function callMcp(
  tool: string,
  args: Record<string, unknown>
): Promise<string> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MCP ${tool} failed: ${res.status} — ${err}`);
  }

  const data = (await res.json()) as {
    result?: {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    error?: { message: string; code?: number };
  };

  if (data.error) {
    throw new Error(`MCP error (${tool}): ${data.error.message}`);
  }

  const content = data.result?.content ?? [];
  const text = content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");

  if (data.result?.isError) {
    throw new Error(`MCP tool error (${tool}): ${text}`);
  }

  return text;
}

// Try to parse MCP response text as a Google Calendar API events list.
// Returns null when the text isn't structured event JSON.
type RawGCalEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
  description?: string;
  htmlLink?: string;
};

function parseEventList(text: string): RawGCalEvent[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as RawGCalEvent[];
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as RawGCalEvent[];
    return null;
  } catch {
    return null;
  }
}

// Format a JS Date as a local dateTime string (no Z, no offset) so the
// MCP server interprets it in the calendar's configured timezone.
function fmtLocalDt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Reverse-lookup: sub-calendar ID → member name (for display in results).
function calIdToName(id: string): string {
  return (
    Object.entries(HOUSEHOLD_CALENDAR_IDS).find(([, v]) => v === id)?.[0] ?? id
  );
}

// ── Tool definitions ──────────────────────────────────────────────────────────

export const CALENDAR_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_upcoming_events",
    description:
      "Fetch upcoming events from the Johnson family calendar. Use this whenever " +
      "the user asks about upcoming events, what's on the calendar, their schedule, " +
      "or plans for a specific period. Each event in the response includes a calendarId " +
      "field — pass that back when calling update_event or delete_event.",
    input_schema: {
      type: "object" as const,
      properties: {
        max_results: {
          type: "number",
          description: "Maximum number of events to return. Default: 10.",
        },
        days_ahead: {
          type: "number",
          description: "How many days into the future to look. Default: 30.",
        },
      },
    },
  },
  {
    name: "create_event",
    description:
      "Create a new event on the family calendar. " +
      "IMPORTANT: Do NOT call this tool until the user has explicitly confirmed. " +
      "First describe the full event details — title, date, time, duration, and which " +
      "members it's assigned to — then ask 'I can add this to the family calendar — " +
      "want me to go ahead?' Only call this after the user says yes.\n\n" +
      "Profile assignment: each household member has a dedicated Google Calendar " +
      "sub-calendar. Skylight displays an event under every profile that is the " +
      "organizer or an attendee. Specify members in guest_names and the correct " +
      "sub-calendars are resolved automatically.\n" +
      "Valid names: Jake, Laurianne, Jocelynn, Nana, Elliot, Henry, Violette.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Event title." },
        date:  { type: "string", description: "Date in YYYY-MM-DD format." },
        time:  {
          type: "string",
          description: "Start time in HH:MM 24-hour format. Omit for all-day events.",
        },
        duration_minutes: {
          type: "number",
          description: "Duration in minutes. Default: 60.",
        },
        description: { type: "string", description: "Optional event description." },
        guest_names: {
          type: "array",
          items: { type: "string" },
          description:
            "Household member names to assign. The first name's sub-calendar " +
            "becomes the organizer; remaining names are added as attendees. " +
            "Omit to create on the primary family calendar with no profile assignment.",
        },
      },
      required: ["title", "date"],
    },
  },
  {
    name: "update_event",
    description:
      "Update an existing family calendar event. " +
      "IMPORTANT: Do NOT call this tool until the user has explicitly confirmed. " +
      "First describe exactly what will change, then ask 'I can update this — " +
      "want me to go ahead?' Only call this after the user says yes.\n\n" +
      "You must pass the calendar_id from the get_upcoming_events result — " +
      "that is the sub-calendar the event lives on.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The event id from get_upcoming_events.",
        },
        calendar_id: {
          type: "string",
          description:
            "The calendarId from get_upcoming_events — identifies which " +
            "sub-calendar holds this event.",
        },
        title:            { type: "string" },
        date:             { type: "string", description: "YYYY-MM-DD" },
        time:             { type: "string", description: "HH:MM 24-hour" },
        duration_minutes: { type: "number" },
        description:      { type: "string" },
        guest_names: {
          type: "array",
          items: { type: "string" },
          description:
            "When provided, replaces the full attendee list. The organizer " +
            "sub-calendar (calendar_id) stays the same — only attendees change.",
        },
      },
      required: ["event_id", "calendar_id"],
    },
  },
  {
    name: "delete_event",
    description:
      "Delete a family calendar event. " +
      "IMPORTANT: Do NOT call this tool until the user has explicitly confirmed. " +
      "Name the event and ask 'I can remove this from the calendar — want me to " +
      "go ahead?' Only call this after the user says yes.\n\n" +
      "You must pass the calendar_id from the get_upcoming_events result.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The event id from get_upcoming_events.",
        },
        calendar_id: {
          type: "string",
          description: "The calendarId from get_upcoming_events.",
        },
      },
      required: ["event_id", "calendar_id"],
    },
  },
];

// ── System prompt addition ────────────────────────────────────────────────────

export const CALENDAR_SYSTEM_BLOCK = `

## Family calendar

You have access to the Johnson family calendar (johnson2016family@gmail.com) via tools.

- Use \`get_upcoming_events\` proactively when the user asks about schedule, upcoming events, plans, or anything time/date related.
- For any write operation (create, update, delete): always confirm first. Describe the full event — title, date, time, duration, assigned members — then say "I can add this to the family calendar — want me to go ahead?" Do not call any write tool until the user explicitly says yes.
- Profile assignment: each member has a dedicated sub-calendar. Skylight shows an event under every member listed in guest_names. Valid names: Jake, Laurianne, Jocelynn, Nana, Elliot, Henry, Violette.
- For update and delete: you need the calendarId returned by get_upcoming_events — always call that first if you don't already have it.
- Dates are YYYY-MM-DD. Times are HH:MM 24-hour.`;

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeCalendarTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    // ── Read ──────────────────────────────────────────────────────────────────
    case "get_upcoming_events": {
      const maxResults = typeof input.max_results === "number" ? input.max_results : 10;
      const daysAhead  = typeof input.days_ahead  === "number" ? input.days_ahead  : 30;

      const now    = new Date().toISOString();
      const future = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

      // Query every member's sub-calendar + the primary/family calendar in parallel.
      const primary = process.env.FAMILY_CALENDAR_ID ?? "primary";
      const calIds  = [...new Set([primary, ...allCalendarIds()])];

      const settled = await Promise.allSettled(
        calIds.map(async (cid) => {
          const text = await callMcp("list_events", {
            calendarId: cid,
            timeMin: now,
            timeMax: future,
            maxResults,
            singleEvents: true,
            orderBy: "startTime",
          });
          return { cid, events: parseEventList(text) ?? [] };
        })
      );

      // Merge and deduplicate by event ID; the organizer calendar's copy wins
      // (it carries the correct calendarId for writes).
      const seen   = new Set<string>();
      const merged: Array<RawGCalEvent & { calendarId: string; assignedTo: string[] }> = [];

      for (const r of settled) {
        if (r.status !== "fulfilled") continue;
        for (const ev of r.value.events) {
          if (!ev.id || seen.has(ev.id)) continue;
          seen.add(ev.id);
          // Derive display names for all assigned profiles.
          const attendeeIds = (ev.attendees ?? [])
            .map((a) => a.email ?? "")
            .filter(Boolean);
          const allIds      = [...new Set([r.value.cid, ...attendeeIds])];
          const assignedTo  = allIds.map(calIdToName);
          merged.push({ ...ev, calendarId: r.value.cid, assignedTo });
        }
      }

      merged.sort((a, b) => {
        const as = a.start?.dateTime ?? a.start?.date ?? "";
        const bs = b.start?.dateTime ?? b.start?.date ?? "";
        return as.localeCompare(bs);
      });

      const result = merged.slice(0, maxResults);
      if (result.length === 0) return `No events in the next ${daysAhead} days.`;
      return JSON.stringify(result, null, 2);
    }

    // ── Create ────────────────────────────────────────────────────────────────
    case "create_event": {
      const guestNames = input.guest_names as string[] | undefined;
      const memberIds  = guestNames?.length ? resolveCalendarIds(guestNames) : [];

      // First member's sub-calendar is the organizer; rest are attendees.
      const targetCalId  = memberIds[0] ?? (process.env.FAMILY_CALENDAR_ID ?? "primary");
      const attendeeIds  = memberIds.slice(1);

      const args: Record<string, unknown> = {
        calendarId: targetCalId,
        summary: input.title,
      };

      if (input.description) args.description = input.description;

      if (input.time) {
        const startDt  = new Date(`${input.date as string}T${input.time as string}:00`);
        const duration = ((input.duration_minutes as number | undefined) ?? 60) * 60 * 1000;
        const endDt    = new Date(startDt.getTime() + duration);
        const tz       = process.env.FAMILY_CALENDAR_TIMEZONE ?? "America/Chicago";
        args.start = { dateTime: fmtLocalDt(startDt), timeZone: tz };
        args.end   = { dateTime: fmtLocalDt(endDt),   timeZone: tz };
      } else {
        args.start = { date: input.date };
        args.end   = { date: input.date };
      }

      if (attendeeIds.length > 0) {
        args.attendees = attendeeIds.map((id) => ({ email: id }));
      }

      return callMcp("create_event", args);
    }

    // ── Update ────────────────────────────────────────────────────────────────
    case "update_event": {
      const calId = input.calendar_id as string;

      const patch: Record<string, unknown> = {
        calendarId: calId,
        eventId:    input.event_id,
      };

      if (input.title       !== undefined) patch.summary     = input.title;
      if (input.description !== undefined) patch.description = input.description;

      if (input.date || input.time || input.duration_minutes) {
        const tz = process.env.FAMILY_CALENDAR_TIMEZONE ?? "America/Chicago";
        if (input.time) {
          const startDt  = new Date(`${input.date as string}T${input.time as string}:00`);
          const duration = ((input.duration_minutes as number | undefined) ?? 60) * 60 * 1000;
          const endDt    = new Date(startDt.getTime() + duration);
          patch.start = { dateTime: fmtLocalDt(startDt), timeZone: tz };
          patch.end   = { dateTime: fmtLocalDt(endDt),   timeZone: tz };
        } else if (input.date) {
          patch.start = { date: input.date };
          patch.end   = { date: input.date };
        }
      }

      if (input.guest_names !== undefined) {
        const memberIds   = resolveCalendarIds(input.guest_names as string[]);
        // Organizer calendar doesn't change; only attendees are replaced.
        const attendeeIds = memberIds.filter((id) => id !== calId);
        patch.attendees   = attendeeIds.map((id) => ({ email: id }));
      }

      return callMcp("update_event", patch);
    }

    // ── Delete ────────────────────────────────────────────────────────────────
    case "delete_event": {
      return callMcp("delete_event", {
        calendarId: input.calendar_id,
        eventId:    input.event_id,
      });
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
