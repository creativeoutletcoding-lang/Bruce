"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ModelPreference from "./ModelPreference";
import GoogleReconnect from "./GoogleReconnect";
import NotificationSettings from "./NotificationSettings";
import RemindersView from "./RemindersView";

export interface SettingsProfile {
  name: string | null;
  email: string | null;
  preferred_model: string | null;
  notification_sensitivity: string | null;
  notification_preferences: Record<string, unknown> | null;
  color_hex: string | null;
}

type Tab = "profile" | "notifications" | "model" | "reminders" | "google";

const TABS: { id: Tab; label: string }[] = [
  { id: "profile",       label: "Profile" },
  { id: "notifications", label: "Notifications" },
  { id: "model",         label: "AI Model" },
  { id: "reminders",     label: "Reminders" },
  { id: "google",        label: "Google" },
];

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

export default function SettingsLayout({ profile }: { profile: SettingsProfile | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Tab lives in the URL (?tab=) so it survives refresh, deep-links, and
  // browser Back navigates between tabs instead of exiting settings.
  const paramTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<Tab>(
    paramTab && TAB_IDS.has(paramTab) ? (paramTab as Tab) : "profile"
  );

  const selectTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    router.replace(`/settings?tab=${tab}`, { scroll: false });
  }, [router]);

  return (
    <div className="settings-shell">
      {/* Nav — pill tabs on mobile, sidebar on desktop */}
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab.id)}
            className={`settings-nav-item${activeTab === tab.id ? " settings-nav-item-active" : ""}`}
            aria-current={activeTab === tab.id ? "page" : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Content panel — keep all tabs mounted so state survives switching */}
      <div className="settings-content">

        {/* Profile */}
        <div style={{ display: activeTab === "profile" ? "block" : "none" }}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.sectionTitle}>Profile</h2>
            </div>
            <div style={styles.rowBody}>
              <div style={styles.row}>
                <span style={styles.label}>Name</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {profile?.color_hex && (
                    <div style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      backgroundColor: profile.color_hex,
                      flexShrink: 0,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.10)",
                    }} />
                  )}
                  <span style={styles.value}>{profile?.name ?? "—"}</span>
                </div>
              </div>
              <div style={{ ...styles.row, borderBottom: "none" }}>
                <span style={styles.label}>Email</span>
                <span style={{ ...styles.value, color: "var(--text-secondary)", fontSize: "0.875rem" }}>
                  {profile?.email ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div style={{ display: activeTab === "notifications" ? "block" : "none" }}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.sectionTitle}>Notifications</h2>
            </div>
            <div style={styles.padBody}>
              <NotificationSettings
                initialSensitivity={(profile?.notification_sensitivity as "low" | "medium" | "high") ?? "medium"}
                initialPrefs={(profile?.notification_preferences ?? {}) as {
                  paused?: boolean;
                  bruce_responses?: boolean;
                  family_messages?: boolean;
                  project_messages?: boolean;
                }}
              />
            </div>
          </div>
        </div>

        {/* AI Model */}
        <div style={{ display: activeTab === "model" ? "block" : "none" }}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.sectionTitle}>AI Model</h2>
            </div>
            <div style={styles.padBody}>
              <ModelPreference initialModel={profile?.preferred_model ?? "claude-sonnet-4-6"} />
            </div>
          </div>
        </div>

        {/* Reminders */}
        <div style={{ display: activeTab === "reminders" ? "block" : "none" }}>
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h2 style={styles.sectionTitle}>Reminders</h2>
            </div>
            <div style={styles.rowBody}>
              <RemindersView />
            </div>
          </div>
        </div>

        {/* Google */}
        <div style={{ display: activeTab === "google" ? "block" : "none" }}>
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
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
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
