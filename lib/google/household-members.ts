// ============================================================
// Household member → Google Calendar sub-calendar ID mapping.
// All sub-calendars live under johnson2016family@gmail.com.
//
// Skylight displays events per profile by reading each sub-calendar.
// An event appears under a profile if that person's sub-calendar ID
// is either the organizer calendar (calendarId in the API call) or
// listed as an attendee email — Google treats the sub-calendar ID as
// both a calendar identifier and an email address for attendee purposes.
//
// To assign an event to multiple profiles:
//   - Create on the first person's sub-calendar (calendarId = their ID)
//   - Add the remaining sub-calendar IDs as attendees
// ============================================================

export const HOUSEHOLD_CALENDAR_IDS: Record<string, string> = {
  Jake:      "07281a040c9feb31d96dbaa55c333cebda6a431b5af457c1175ab7645f673f72@group.calendar.google.com",
  Laurianne: "a8d6c7c251bbdf508cf0cd67ea8258c01bdd38d77d0a2b3d7681adf99daf3736@group.calendar.google.com",
  Jocelynn:  "f81fb5dcc801c8812d2ed4b868b5c947f4c43f70795e68b4626e61181a294692@group.calendar.google.com",
  Nana:      "2be86dc3cf881bc0c4e80ce293bc242504fc5e7f4ef3a5560b8379751e0a3be4@group.calendar.google.com",
  Elliot:    "96c339d8afd938c3bd56438d104dbbcff9b143c7b7368aef9aa1566f2872b063@group.calendar.google.com",
  Henry:     "56b69492b3531bbc685f5f5a7a0e4587f5a9c19fd5f05f5b5c894f7ba64bccdf@group.calendar.google.com",
  Violette:  "0aa07f7d88e92682d83f6249a2199b568f39f6101c2ffa4a90df2cd270dd315e@group.calendar.google.com",
};

// Returns all sub-calendar IDs (used by getUpcomingEvents to query every member's calendar).
export function allCalendarIds(): string[] {
  return Object.values(HOUSEHOLD_CALENDAR_IDS);
}

// Accepts an array of member names (any case) and returns their sub-calendar IDs.
// Names that don't match a household member are silently skipped.
export function resolveCalendarIds(names: string[]): string[] {
  return names
    .map((name) => {
      const key = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      return HOUSEHOLD_CALENDAR_IDS[key] ?? null;
    })
    .filter((id): id is string => id !== null);
}
