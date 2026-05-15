import Link from "next/link";

const adminEmail = process.env.ADMIN_EMAIL ?? "jake@heybruce.app";

export default function TermsPage() {
  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <Link href="/" style={styles.backLink}>← Bruce</Link>
        </header>

        <main style={styles.content}>
          <h1 style={styles.h1}>Terms of Use</h1>
          <p style={styles.meta}>Last updated: May 2026</p>

          <section style={styles.section}>
            <h2 style={styles.h2}>Private Application</h2>
            <p style={styles.p}>
              Bruce is a private household AI application built and operated exclusively for personal
              use by members of the Johnson family. It is not a commercial product. Access is
              restricted to individuals who have received a direct invitation from the app
              administrator and have been granted an account.
            </p>
            <p style={styles.p}>
              By using Bruce, you confirm that you are an authorized member of the Johnson household
              and that you have been granted access by the administrator. Unauthorized access is
              prohibited.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Acceptable Use</h2>
            <p style={styles.p}>
              Bruce is provided for personal household use only. You agree to use Bruce only for
              lawful purposes and in a manner consistent with its intended use as a household
              assistant. You agree not to:
            </p>
            <ul style={styles.ul}>
              <li style={styles.li}>Attempt to access accounts or data belonging to other household members.</li>
              <li style={styles.li}>Use Bruce to generate, store, or transmit harmful, illegal, or offensive content.</li>
              <li style={styles.li}>Attempt to reverse-engineer, compromise, or disrupt the application or its underlying services.</li>
              <li style={styles.li}>Share your account credentials with anyone outside the authorized household.</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Google Services Integration</h2>
            <p style={styles.p}>
              Bruce integrates with Google Calendar, Gmail, and Google Drive using OAuth 2.0
              authorization. By authorizing these integrations, you grant Bruce permission to access
              and act on the specified Google services on your behalf, as described in the{" "}
              <Link href="/privacy" style={styles.link}>Privacy Policy</Link>.
            </p>
            <p style={styles.p}>
              You can revoke Bruce&apos;s access to your Google account at any time through your
              Google Account settings at{" "}
              <a href="https://myaccount.google.com/permissions" style={styles.link} target="_blank" rel="noopener noreferrer">
                myaccount.google.com/permissions
              </a>
              . Revoking access will disable Google-connected features within Bruce.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>AI-Generated Content</h2>
            <p style={styles.p}>
              Bruce uses AI to generate responses, suggestions, and content. AI-generated content
              may contain errors or inaccuracies. You are responsible for verifying any information
              Bruce provides before acting on it, particularly for time-sensitive, financial, medical,
              or legal matters.
            </p>
            <p style={styles.p}>
              Bruce will always ask for explicit confirmation before performing actions that modify
              external services (such as creating calendar events, sending emails, or modifying
              files). You are responsible for reviewing and confirming these actions before approving
              them.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>No Warranty</h2>
            <p style={styles.p}>
              Bruce is provided &quot;as is&quot; for personal household use. No warranties are made regarding
              availability, accuracy, or fitness for any particular purpose. The app may be
              unavailable during maintenance or due to service disruptions outside our control.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Changes to These Terms</h2>
            <p style={styles.p}>
              These terms may be updated from time to time. Household members will be notified of
              material changes by the administrator. Continued use of Bruce after changes are
              communicated constitutes acceptance of the updated terms.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Contact</h2>
            <p style={styles.p}>
              Questions about these terms should be directed to:
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
