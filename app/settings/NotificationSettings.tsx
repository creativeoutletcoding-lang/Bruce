"use client";

import { useState, useCallback } from "react";

type Sensitivity = "low" | "medium" | "high";

interface NotifPrefs {
  paused?: boolean;
  bruce_responses?: boolean;
  family_messages?: boolean;
  project_messages?: boolean;
}

interface NotificationSettingsProps {
  initialSensitivity: Sensitivity;
  initialPrefs: NotifPrefs;
}

const SENSITIVITY_OPTIONS: { value: Sensitivity; label: string; description: string }[] = [
  { value: "high",   label: "High",   description: "Always deliver, even while viewing the chat" },
  { value: "medium", label: "Medium", description: "Skip if you're active in the chat (default)" },
  { value: "low",    label: "Low",    description: "Only notify after 10 minutes away from the chat" },
];

export default function NotificationSettings({
  initialSensitivity,
  initialPrefs,
}: NotificationSettingsProps) {
  const [sensitivity, setSensitivity] = useState<Sensitivity>(initialSensitivity);
  const [prefs, setPrefs] = useState<NotifPrefs>({
    paused:           initialPrefs.paused           ?? false,
    bruce_responses:  initialPrefs.bruce_responses  ?? true,
    family_messages:  initialPrefs.family_messages  ?? true,
    project_messages: initialPrefs.project_messages ?? true,
  });
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (nextSensitivity: Sensitivity, nextPrefs: NotifPrefs) => {
      setSaving(true);
      await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notification_sensitivity: nextSensitivity,
          notification_preferences: nextPrefs,
        }),
      }).catch(() => {});
      setSaving(false);
    },
    []
  );

  function handleSensitivity(value: Sensitivity) {
    setSensitivity(value);
    save(value, prefs);
  }

  function handlePref(key: keyof NotifPrefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    save(sensitivity, next);
  }

  const isPaused = prefs.paused ?? false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Master pause */}
      <div style={styles.toggleRow}>
        <div style={styles.toggleLabel}>
          <span style={styles.toggleTitle}>Pause all notifications</span>
          <span style={styles.toggleDesc}>No pushes until you turn this off</span>
        </div>
        <Toggle
          checked={isPaused}
          disabled={saving}
          onChange={(v) => handlePref("paused", v)}
        />
      </div>

      {/* Per-type toggles — dimmed when paused */}
      <div style={{ ...styles.group, opacity: isPaused ? 0.4 : 1, ...(isPaused ? { pointerEvents: "none" as const } : {}) }}>
        <ToggleRow
          title="Family messages"
          desc="Messages sent by family members"
          checked={prefs.family_messages ?? true}
          disabled={saving}
          onChange={(v) => handlePref("family_messages", v)}
        />
        <ToggleRow
          title="Project messages"
          desc="Messages from shared project chats"
          checked={prefs.project_messages ?? true}
          disabled={saving}
          onChange={(v) => handlePref("project_messages", v)}
        />
        <ToggleRow
          title="Bruce responses"
          desc="When Bruce replies to a message you can see"
          checked={prefs.bruce_responses ?? true}
          disabled={saving}
          onChange={(v) => handlePref("bruce_responses", v)}
          last
        />
      </div>

      {/* Sensitivity */}
      <div style={{ ...styles.group, gap: "12px", borderBottom: "none", paddingBottom: 0, opacity: isPaused ? 0.4 : 1, ...(isPaused ? { pointerEvents: "none" as const } : {}) }}>
        <span style={styles.groupLabel}>Delivery timing</span>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {SENSITIVITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleSensitivity(opt.value)}
              disabled={saving}
              type="button"
              style={{
                ...styles.sensitivityBtn,
                border: `1px solid ${sensitivity === opt.value ? "var(--accent)" : "var(--border)"}`,
                backgroundColor: sensitivity === opt.value ? "rgba(15,110,86,0.06)" : "transparent",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--text-primary)" }}>
                  {opt.label}
                </span>
                {sensitivity === opt.value && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: "auto" }}>
                    <path d="M2 7l4 4 6-6" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ToggleRow({
  title,
  desc,
  checked,
  disabled,
  onChange,
  last,
}: {
  title: string;
  desc: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <div style={{ ...styles.toggleRow, borderBottom: last ? "none" : "1px solid var(--border)", paddingBottom: last ? 0 : "16px" }}>
      <div style={styles.toggleLabel}>
        <span style={styles.toggleTitle}>{title}</span>
        <span style={styles.toggleDesc}>{desc}</span>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      type="button"
      style={{
        flexShrink: 0,
        width: "44px",
        height: "26px",
        borderRadius: "13px",
        backgroundColor: checked ? "var(--accent)" : "var(--border-strong)",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        position: "relative",
        transition: "background-color 150ms ease",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "3px",
          left: checked ? "21px" : "3px",
          width: "20px",
          height: "20px",
          borderRadius: "50%",
          backgroundColor: "#fff",
          transition: "left 150ms ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    paddingBottom: "4px",
    borderBottom: "1px solid var(--border)",
  },
  groupLabel: {
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: "var(--text-tertiary)",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
  },
  toggleLabel: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  toggleTitle: {
    fontSize: "0.9375rem",
    color: "var(--text-primary)",
    fontWeight: 500,
  },
  toggleDesc: {
    fontSize: "0.8125rem",
    color: "var(--text-secondary)",
  },
  sensitivityBtn: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    padding: "12px 14px",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    transition: "all var(--transition)",
  },
};
