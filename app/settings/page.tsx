import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BackButton from "./BackButton";
import ModelPreference from "./ModelPreference";
import GoogleReconnect from "./GoogleReconnect";
import NotificationSettings from "./NotificationSettings";
import RemindersView from "./RemindersView";

interface ProfileRow {
  name: string;
  email: string;
  avatar_url: string | null;
  preferred_model: string | null;
  notification_sensitivity: string | null;
  notification_preferences: Record<string, unknown> | null;
  color_hex: string | null;
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("name, email, avatar_url, preferred_model, notification_sensitivity, notification_preferences, color_hex")
    .eq("id", user.id)
    .single();

  const p = profile as ProfileRow | null;

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <BackButton />
        <h1 style={styles.heading}>Settings</h1>

        {/* ── Profile ───────────────────────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.sectionTitle}>Profile</h2>
          </div>
          <div style={styles.rowBody}>
            <div style={styles.row}>
              <span style={styles.label}>Name</span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {p?.color_hex && (
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      backgroundColor: p.color_hex,
                      flexShrink: 0,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.10)",
                    }}
                  />
                )}
                <span style={styles.value}>{p?.name ?? "—"}</span>
              </div>
            </div>
            <div style={{ ...styles.row, borderBottom: "none" }}>
              <span style={styles.label}>Email</span>
              <span style={{ ...styles.value, color: "var(--text-secondary)", fontSize: "0.875rem" }}>
                {p?.email ?? "—"}
              </span>
            </div>
          </div>
        </div>

        {/* ── Notifications ─────────────────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.sectionTitle}>Notifications</h2>
          </div>
          <div style={styles.padBody}>
            <NotificationSettings
              initialSensitivity={(p?.notification_sensitivity as "low" | "medium" | "high") ?? "medium"}
              initialPrefs={
                (p?.notification_preferences ?? {}) as {
                  paused?: boolean;
                  bruce_responses?: boolean;
                  family_messages?: boolean;
                  project_messages?: boolean;
                }
              }
            />
          </div>
        </div>

        {/* ── AI Model ──────────────────────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.sectionTitle}>AI Model</h2>
          </div>
          <div style={styles.padBody}>
            <ModelPreference initialModel={p?.preferred_model ?? "claude-sonnet-4-6"} />
          </div>
        </div>

        {/* ── Reminders ─────────────────────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.sectionTitle}>Reminders</h2>
          </div>
          <div style={styles.rowBody}>
            <RemindersView />
          </div>
        </div>

        {/* ── Google ────────────────────────────────────────────────────── */}
        <div style={styles.card}>
          <div style={styles.cardHeader}>
            <h2 style={styles.sectionTitle}>Google</h2>
          </div>
          <div style={styles.padBody}>
            <p style={styles.helpText}>
              Re-run the Google authorization flow to refresh your OAuth token and ensure
              Bruce has the correct Drive permissions. Required if Bruce cannot see files
              inside existing Drive folders.
            </p>
            <GoogleReconnect />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100dvh",
    overflowY: "auto",
    padding: "24px 16px 56px",
    backgroundColor: "var(--bg-primary)",
  },
  content: {
    maxWidth: "520px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  heading: {
    fontSize: "1.375rem",
    fontWeight: "700",
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
    margin: "4px 0 0",
  },
  card: {
    backgroundColor: "var(--bg-secondary)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  cardHeader: {
    padding: "14px 20px",
    borderBottom: "1px solid var(--border)",
  },
  sectionTitle: {
    fontSize: "0.6875rem",
    fontWeight: "700",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--text-tertiary)",
    margin: 0,
  },
  rowBody: {
    padding: "0 20px",
  },
  padBody: {
    padding: "20px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "14px 0",
    borderBottom: "1px solid var(--border)",
  },
  label: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
    flexShrink: 0,
  },
  value: {
    fontSize: "0.9375rem",
    color: "var(--text-primary)",
    textAlign: "right" as const,
  },
  helpText: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
    lineHeight: 1.5,
    marginTop: 0,
    marginBottom: "16px",
  },
};
