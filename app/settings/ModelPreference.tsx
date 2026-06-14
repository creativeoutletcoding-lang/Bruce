"use client";

import { useState } from "react";
import { MODELS, DEFAULT_MODEL, getModel, validEffortForModel } from "@/lib/models";

interface ModelPreferenceProps {
  initialModel: string;
  initialEffort?: string | null;
}

export default function ModelPreference({ initialModel, initialEffort }: ModelPreferenceProps) {
  const [currentModel, setCurrentModel] = useState(initialModel);
  const [currentEffort, setCurrentEffort] = useState<string | null>(initialEffort ?? null);
  const [saving, setSaving] = useState(false);

  const selectedModel = getModel(currentModel);
  const activeEffort = validEffortForModel(currentModel, currentEffort);

  async function handleSelect(modelId: string) {
    setSaving(true);
    setCurrentModel(modelId);
    await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_model: modelId }),
    });
    setSaving(false);
  }

  async function handleEffortSelect(effort: string) {
    setSaving(true);
    setCurrentEffort(effort);
    await fetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferred_effort: effort }),
    });
    setSaving(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {MODELS.map((m) => (
        <button
          key={m.id}
          onClick={() => handleSelect(m.id)}
          disabled={saving}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            padding: "14px 16px",
            borderRadius: "var(--radius-md)",
            border: `1px solid ${currentModel === m.id ? "var(--accent)" : "var(--border)"}`,
            backgroundColor: currentModel === m.id ? "var(--active-bg)" : "transparent",
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            transition: "all var(--transition)",
          }}
          type="button"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: "500", color: "var(--text-primary)" }}>
              {m.displayName}
            </span>
            {m.id === DEFAULT_MODEL && (
              <span style={{
                fontSize: "0.6875rem",
                fontWeight: "500",
                color: "var(--accent)",
                backgroundColor: "rgba(15, 110, 86, 0.1)",
                padding: "2px 6px",
                borderRadius: "var(--radius-full)",
              }}>
                Default
              </span>
            )}
            {currentModel === m.id && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginLeft: "auto" }}>
                <path d="M2 7l4 4 6-6" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", lineHeight: "1.4", margin: 0 }}>
            {m.description}
          </p>
        </button>
      ))}

      {selectedModel?.supportsEffort && (
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "0.8125rem", fontWeight: "600", color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Effort
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {selectedModel.effortLevels.map((level) => (
              <button
                key={level}
                onClick={() => handleEffortSelect(level)}
                disabled={saving}
                style={{
                  flex: "1 1 auto",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${activeEffort === level ? "var(--accent)" : "var(--border)"}`,
                  backgroundColor: activeEffort === level ? "var(--active-bg)" : "transparent",
                  color: activeEffort === level ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: "0.8125rem",
                  fontWeight: "500",
                  textTransform: "capitalize",
                  cursor: "pointer",
                  transition: "all var(--transition)",
                }}
                type="button"
              >
                {level}
              </button>
            ))}
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", lineHeight: "1.4", margin: 0 }}>
            Higher effort means deeper reasoning and more thorough answers; lower effort is faster and more concise.
          </p>
        </div>
      )}
    </div>
  );
}
