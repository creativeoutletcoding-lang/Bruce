import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BackButton from "./BackButton";
import ModelPreference from "./ModelPreference";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("name, email, avatar_url, preferred_model")
    .eq("id", user.id)
    .single();

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <BackButton />
        <h1 style={styles.heading}>Settings</h1>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Profile</h2>
          <div style={styles.row}>
            <span style={styles.label}>Name</span>
            <span style={styles.value}>{profile?.name ?? "—"}</span>
          </div>
          <div style={styles.row}>
            <span style={styles.label}>Email</span>
            <span style={styles.value}>{profile?.email ?? "—"}</span>
          </div>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>Notifications</h2>
          <p style={styles.placeholder}>Notification preferences coming in a future phase.</p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>AI Model</h2>
          <ModelPreference initialModel={(profile as { name: string; email: string; avatar_url: string | null; preferred_model: string | null } | null)?.preferred_model ?? "claude-sonnet-4-6"} />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100dvh",
    overflowY: "auto",
    padding: "32px 16px",
    backgroundColor: "var(--bg-primary)",
  },
  content: {
    maxWidth: "480px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "32px",
  },
  heading: {
    fontSize: "1.375rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  sectionTitle: {
    fontSize: "0.8125rem",
    fontWeight: "600",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    color: "var(--text-tertiary)",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 0",
    borderBottom: "1px solid var(--border)",
  },
  label: {
    fontSize: "0.9375rem",
    color: "var(--text-secondary)",
  },
  value: {
    fontSize: "0.9375rem",
    color: "var(--text-primary)",
  },
  placeholder: {
    fontSize: "0.875rem",
    color: "var(--text-tertiary)",
  },
};
