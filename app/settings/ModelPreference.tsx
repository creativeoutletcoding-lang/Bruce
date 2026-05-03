"use client";

import { useState } from "react";
import { MODELS, DEFAULT_MODEL } from "@/lib/models";

interface ModelPreferenceProps {
  initialModel: string;
}

export default function ModelPreference({ initialModel }: ModelPreferenceProps) {
  const [currentModel, setCurrentModel] = useState(initialModel);
  const [saving, setSaving] = useState(false);

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
            backgroundColor: currentModel === m.id ? "rgba(15, 110, 86, 0.06)" : "transparent",
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            transition: "all var(--transition)",
          }}
          type="button"
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "0.9375rem", fontWeight: "500", color: "var(--text-primary)" }}>
              {m.label}
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
    </div>
  );
}
