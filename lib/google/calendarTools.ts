// ============================================================
// Bruce — Anthropic tool definitions + executor for Google Calendar.
// Imported by /api/chat and /api/family/chat routes.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import {
  getUpcomingEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/google/calendar";

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
    case "get_upcoming_events": {
      const maxResults = typeof input.max_results === "number" ? input.max_results : 10;
      const daysAhead  = typeof input.days_ahead  === "number" ? input.days_ahead  : 30;
      const events = await getUpcomingEvents(maxResults, daysAhead);
      if (events.length === 0) {
        return `No events in the next ${daysAhead} days.`;
      }
      return JSON.stringify(events, null, 2);
    }

    case "create_event": {
      const event = await createCalendarEvent({
        title:            input.title            as string,
        date:             input.date             as string,
        time:             input.time             as string | undefined,
        duration_minutes: input.duration_minutes as number | undefined,
        description:      input.description      as string | undefined,
        guest_names:      input.guest_names      as string[] | undefined,
      });
      return JSON.stringify(event, null, 2);
    }

    case "update_event": {
      const event = await updateCalendarEvent(input.event_id as string, {
        calendar_id:      input.calendar_id      as string,
        title:            input.title            as string | undefined,
        date:             input.date             as string | undefined,
        time:             input.time             as string | undefined,
        duration_minutes: input.duration_minutes as number | undefined,
        description:      input.description      as string | undefined,
        guest_names:      input.guest_names      as string[] | undefined,
      });
      return JSON.stringify(event, null, 2);
    }

    case "delete_event": {
      await deleteCalendarEvent(
        input.event_id   as string,
        input.calendar_id as string
      );
      return "Event deleted successfully.";
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
