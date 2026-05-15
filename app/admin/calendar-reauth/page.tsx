import { createClient } from "@/lib/supabase/server";

interface Props {
  searchParams: Promise<{ success?: string; error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  google_denied:    "Google OAuth was cancelled or denied.",
  missing_params:   "OAuth callback was missing required parameters.",
  state_mismatch:   "Security check failed (state mismatch). Try again.",
  exchange_failed:  "Token exchange with Google failed. Check Vercel logs.",
  no_refresh_token: "Google did not return a refresh token. Make sure 'prompt=consent' is in the OAuth request.",
  store_failed:     "Token exchange succeeded but writing to Supabase failed. Check Vercel logs.",
};

export default async function CalendarReauthPage({ searchParams }: Props) {
  const { success, error } = await searchParams;

  // Read current status from system_config (admin RLS allows this)
  const supabase = await createClient();
  const { data: configRow } = await supabase
    .from("system_config")
    .select("value, updated_at")
    .eq("key", "family_calendar_refresh_token")
    .maybeSingle();

  const hasStoredToken = !!configRow;
  const storedAt = configRow?.updated_at
    ? new Date(configRow.updated_at as string).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric",
        hour: "numeric", minute: "2-digit", timeZoneName: "short",
      })
    : null;

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Family Calendar Reauth</h1>
      <p style={styles.description}>
        Reconnects Bruce to the shared Johnson family Google Calendar account
        by initiating a fresh OAuth authorization and storing the new refresh
        token in Supabase.
      </p>

      <div style={styles.card}>
        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Token status</span>
          {hasStoredToken ? (
            <span style={{ ...styles.statusValue, color: "var(--accent)" }}>
              Stored in system_config{storedAt ? ` — updated ${storedAt}` : ""}
            </span>
          ) : (
            <span style={{ ...styles.statusValue, color: "var(--text-tertiary)" }}>
              Not in Supabase — falling back to FAMILY_CALENDAR_REFRESH_TOKEN env var
            </span>
          )}
        </div>

        {success && (
          <div style={{ ...styles.banner, ...styles.bannerSuccess }}>
            Calendar reconnected. New refresh token stored in system_config.
          </div>
        )}

        {error && (
          <div style={{ ...styles.banner, ...styles.bannerError }}>
            {ERROR_MESSAGES[error] ?? `Unknown error: ${error}`}
          </div>
        )}

        <a href="/api/admin/calendar-reauth" style={styles.button}>
          Reconnect Family Calendar
        </a>

        <p style={styles.note}>
          You will be redirected to Google to authorize calendar access for the
          Johnson family account. After completing the sign-in, the refresh
          token is stored automatically.
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "32px",
    maxWidth: "560px",
  },
  heading: {
    fontSize: "1.25rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    marginBottom: "8px",
    letterSpacing: "-0.01em",
  },
  description: {
    fontSize: "0.875rem",
    color: "var(--text-secondary)",
    lineHeight: "1.6",
    marginBottom: "24px",
  },
  card: {
    backgroundColor: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  statusRow: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  statusLabel: {
    fontSize: "0.75rem",
    fontWeight: "600",
    color: "var(--text-tertiary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  statusValue: {
    fontSize: "0.875rem",
    lineHeight: "1.5",
  },
  banner: {
    padding: "12px 14px",
    borderRadius: "var(--radius-md)",
    fontSize: "0.875rem",
    lineHeight: "1.5",
  },
  bannerSuccess: {
    backgroundColor: "rgba(15,110,86,0.12)",
    color: "var(--accent)",
    border: "1px solid rgba(15,110,86,0.25)",
  },
  bannerError: {
    backgroundColor: "rgba(192,57,43,0.08)",
    color: "#c0392b",
    border: "1px solid rgba(192,57,43,0.2)",
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 20px",
    height: "40px",
    backgroundColor: "var(--accent)",
    color: "#ffffff",
    fontSize: "0.875rem",
    fontWeight: "600",
    borderRadius: "var(--radius-md)",
    textDecoration: "none",
    alignSelf: "flex-start",
  },
  note: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    lineHeight: "1.55",
    marginTop: "4px",
  },
};
