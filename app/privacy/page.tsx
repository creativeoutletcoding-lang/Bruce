import Link from "next/link";

const adminEmail = process.env.ADMIN_EMAIL ?? "jake@heybruce.app";

export default function PrivacyPage() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <Link href="/" style={styles.backLink}>← Bruce</Link>
        </header>

        <main style={styles.content}>
          <h1 style={styles.h1}>Privacy Policy</h1>
          <p style={styles.meta}>Last updated: May 2026</p>

          <section style={styles.section}>
            <h2 style={styles.h2}>About This App</h2>
            <p style={styles.p}>
              Bruce is a private household AI application built exclusively for personal family use
              by the Johnson family. It is not a commercial product and is not available to the
              general public. Access is strictly limited to invited household members who have been
              granted access by the app administrator.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Google Data We Access</h2>
            <p style={styles.p}>
              Bruce integrates with Google services to provide functionality requested by household
              members. The following Google data is accessed:
            </p>

            <h3 style={styles.h3}>Google Calendar</h3>
            <p style={styles.p}>
              Bruce requests read and write access to Google Calendar. This access is used to read
              calendar events to surface relevant scheduling context in conversations, and to create,
              update, and delete calendar events when explicitly requested by the user. No calendar
              data is accessed without an explicit user request.
            </p>

            <h3 style={styles.h3}>Gmail</h3>
            <p style={styles.p}>
              Bruce requests read-only access to Gmail. This access is used solely to read email
              subjects, sender information, and message content when the user explicitly asks Bruce
              to search or summarize their inbox. Bruce never sends, modifies, moves, or deletes
              email messages of any kind.
            </p>

            <h3 style={styles.h3}>Google Drive</h3>
            <p style={styles.p}>
              Bruce requests read and write access to Google Drive, scoped to a Bruce-specific
              folder that the app creates and manages on the user&apos;s behalf. This access is used to
              store files referenced in conversations and to read documents the user shares with
              Bruce within that folder. Bruce never accesses, reads, modifies, or deletes files
              outside the dedicated Bruce folder it creates.
            </p>

            <h3 style={styles.h3}>Google Profile</h3>
            <p style={styles.p}>
              Bruce reads the user&apos;s Google account name and email address. This information is
              used solely for authentication and to identify the user within the household app.
              No profile data is used for any other purpose.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>How We Use Google User Data</h2>
            <p style={styles.p}>
              Google user data accessed by Bruce is used exclusively to provide the features
              described above, on behalf of the authenticated user who requested them. Specifically:
            </p>
            <ul style={styles.ul}>
              <li style={styles.li}>Data is never shared with third parties.</li>
              <li style={styles.li}>Data is never used to train AI models, including the AI models that power Bruce.</li>
              <li style={styles.li}>Data is never sold, licensed, or transferred to any other party.</li>
              <li style={styles.li}>Data is never used for advertising or any commercial purpose.</li>
              <li style={styles.li}>
                Google API data is used only to fulfill the specific user action that triggered
                the API call, and is not stored beyond what is necessary to complete that action.
              </li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Data Storage and Security</h2>
            <p style={styles.p}>
              All application data is stored in a private Supabase database hosted in the United
              States. The database enforces row-level security at the database level — each user&apos;s
              data is isolated and inaccessible to other household members. No household member can
              read, access, or modify another member&apos;s private data, conversations, or files.
            </p>
            <p style={styles.p}>
              Google OAuth tokens (access tokens and refresh tokens) are stored securely in the
              database and are used only to make API calls on behalf of the authenticated user who
              granted the token. Tokens are never exposed to the client application and are
              accessible only to server-side processes running on behalf of the user.
            </p>
            <p style={styles.p}>
              Conversation history is stored in the database and is private to each individual
              user. No household member can access another member&apos;s conversations.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Data Retention and Deletion</h2>
            <p style={styles.p}>
              Conversation history and associated data is stored until the user explicitly deletes
              it. Users can delete individual conversations at any time from within the app.
            </p>
            <p style={styles.p}>
              Users who wish to delete all of their data, including their account, stored
              conversations, and associated Google tokens, may contact the app administrator using
              the contact information below. Upon receiving a deletion request, the administrator
              will deactivate the account and initiate permanent deletion of all associated data
              within 30 days.
            </p>
            <p style={styles.p}>
              If a user&apos;s account is deactivated or an invite is revoked, their data enters a
              30-day holding period before permanent deletion.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Children&apos;s Privacy</h2>
            <p style={styles.p}>
              Bruce is not designed for or directed at children. Household member accounts are
              limited to adults and teenagers who are members of the Johnson household. Children
              in the household do not have accounts and do not provide any data to Bruce.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Changes to This Policy</h2>
            <p style={styles.p}>
              If this privacy policy changes materially, household members will be notified by the
              app administrator. Continued use of Bruce after a policy update constitutes acceptance
              of the updated terms.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Contact</h2>
            <p style={styles.p}>
              Questions about this privacy policy or requests to access, correct, or delete your
              data should be directed to:
            </p>
            <p style={styles.p}>
              <strong>Jake Johnson</strong>, Administrator<br />
              <a href={`mailto:${adminEmail}`} style={styles.link}>{adminEmail}</a>
            </p>
          </section>
        </main>

        <footer style={styles.footer}>
          <Link href="/" style={styles.footerLink}>← Back to Bruce</Link>
        </footer>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "var(--bg-secondary)",
    padding: "40px 24px",
  },
  container: {
    maxWidth: "680px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "0",
  },
  header: {
    marginBottom: "40px",
  },
  backLink: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
    textDecoration: "none",
    fontWeight: "500",
  },
  content: {
    backgroundColor: "var(--bg-primary)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border)",
    padding: "40px",
    display: "flex",
    flexDirection: "column",
    gap: "0",
  },
  h1: {
    fontSize: "1.75rem",
    fontWeight: "700",
    letterSpacing: "-0.02em",
    color: "var(--text-primary)",
    marginBottom: "8px",
  },
  meta: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    marginBottom: "40px",
  },
  section: {
    marginBottom: "36px",
  },
  h2: {
    fontSize: "1.0625rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    marginBottom: "12px",
    letterSpacing: "-0.01em",
  },
  h3: {
    fontSize: "0.9375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    marginTop: "20px",
    marginBottom: "8px",
  },
  p: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
    lineHeight: "1.65",
    marginBottom: "12px",
  },
  ul: {
    paddingLeft: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  li: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
    lineHeight: "1.65",
  },
  link: {
    color: "var(--accent)",
    textDecoration: "none",
  },
  footer: {
    marginTop: "32px",
    paddingBottom: "8px",
  },
  footerLink: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    textDecoration: "none",
  },
};
