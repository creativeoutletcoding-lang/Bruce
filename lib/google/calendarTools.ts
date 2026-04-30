// ============================================================
// Bruce — Anthropic tool definitions + executor for Google Calendar.
// Imported by /api/chat and /api/family/chat routes.
//
// Step 1 (deployed): get_upcoming_events only.
// Steps 2-3 (pending confirmation): create_event, update_event, delete_event.
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
      "or plans for a specific period.",
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
      "First describe the full event details and ask 'I can add this to the family " +
      "calendar — want me to go ahead?' Only call this after the user says yes.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Event title." },
        date: { type: "string", description: "Date in YYYY-MM-DD format." },
        time: {
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
            "Household member names to assign (e.g. ['Jake', 'Jocelynn']). " +
            "Skylight shows the event under each named profile. " +
            "Valid names: Jake, Laurianne, Jocelynn, Nana, Elliot, Henry, Violette.",
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
      "First describe what will change and ask 'I can update this — want me to go ahead?' " +
      "Only call this after the user says yes.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: { type: "string", description: "The event ID from get_upcoming_events." },
        title: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM 24-hour" },
        duration_minutes: { type: "number" },
        description: { type: "string" },
        guest_names: {
          type: "array",
          items: { type: "string" },
          description:
            "Replaces the entire guest list. Omit to leave guests unchanged.",
        },
      },
      required: ["event_id"],
    },
  },
  {
    name: "delete_event",
    description:
      "Delete a family calendar event. " +
      "IMPORTANT: Do NOT call this tool until the user has explicitly confirmed. " +
      "First name the event and ask 'I can remove this from the calendar — want me to go ahead?' " +
      "Only call this after the user says yes.",
    input_schema: {
      type: "object" as const,
      properties: {
        event_id: {
          type: "string",
          description: "The event ID from get_upcoming_events.",
        },
      },
      required: ["event_id"],
    },
  },
];

// ── System prompt addition ────────────────────────────────────────────────────
// Appended to the base system prompt in routes that wire these tools.

export const CALENDAR_SYSTEM_BLOCK = `

## Family calendar

You have access to the Johnson family calendar (johnson2016family@gmail.com) via tools.

- Use \`get_upcoming_events\` proactively when the user asks about schedule, upcoming events, plans, or anything time/date related.
- For any write operation (create, update, delete): always confirm first. Describe the full event — title, date, time, duration, assigned members — then say "I can add this to the family calendar — want me to go ahead?" Do not call the write tool until the user explicitly says yes.
- Guest assignment: when a member is listed as a guest, Skylight displays the event under their profile. Name members explicitly ("add Jake and Jocelynn") and include them in guest_names.
- Dates are YYYY-MM-DD. Times are HH:MM 24-hour.`;

// ── Tool executor ─────────────────────────────────────────────────────────────

export async function executeCalendarTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "get_upcoming_events": {
      const maxResults =
        typeof input.max_results === "number" ? input.max_results : 10;
      const daysAhead =
        typeof input.days_ahead === "number" ? input.days_ahead : 30;
      const events = await getUpcomingEvents(maxResults, daysAhead);
      if (events.length === 0) {
        return `No events in the next ${daysAhead} days.`;
      }
      return JSON.stringify(events, null, 2);
    }

    case "create_event": {
      const event = await createCalendarEvent({
        title: input.title as string,
        date: input.date as string,
        time: input.time as string | undefined,
        duration_minutes: input.duration_minutes as number | undefined,
        description: input.description as string | undefined,
        guest_names: input.guest_names as string[] | undefined,
      });
      return JSON.stringify(event, null, 2);
    }

    case "update_event": {
      const event = await updateCalendarEvent(input.event_id as string, {
        title: input.title as string | undefined,
        date: input.date as string | undefined,
        time: input.time as string | undefined,
        duration_minutes: input.duration_minutes as number | undefined,
        description: input.description as string | undefined,
        guest_names: input.guest_names as string[] | undefined,
      });
      return JSON.stringify(event, null, 2);
    }

    case "delete_event": {
      await deleteCalendarEvent(input.event_id as string);
      return "Event deleted successfully.";
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
