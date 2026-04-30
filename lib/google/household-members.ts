// ============================================================
// Household member → Google account email mapping.
// Used to assign calendar events to Skylight profiles via the
// guest list. Skylight shows an event under each profile whose
// Google email appears in the attendees list.
//
// Fill in the real Google account email for each member.
// Placeholder emails are intentionally invalid so no real
// Google account gets an accidental invite while these are unset.
// ============================================================

export const HOUSEHOLD_EMAILS: Record<string, string> = {
  Jake: "jake.placeholder@example.com",
  Laurianne: "laurianne.placeholder@example.com",
  Jocelynn: "jocelynn.placeholder@example.com",
  Nana: "nana.placeholder@example.com",
  Elliot: "elliot.placeholder@example.com",
  Henry: "henry.placeholder@example.com",
  Violette: "violette.placeholder@example.com",
};

// Accepts an array of member names (any case) and returns their emails.
// Names that don't match any household member are silently skipped.
export function resolveGuestEmails(names: string[]): string[] {
  return names
    .map((name) => {
      const key = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
      return HOUSEHOLD_EMAILS[key] ?? null;
    })
    .filter((email): email is string => email !== null);
}
