"use client";

import { useEffect, useState } from "react";

interface GoogleMemberStatus {
  name: string;
  connected: boolean;
  token_expired: boolean;
}

interface Service {
  name: string;
  status: "ok" | "partial" | "error";
  detail: string;
  checked_at: string;
  members?: GoogleMemberStatus[];
}

interface HealthData {
  services: Service[];
  model: string;
  messages_last_24h: number;
  errors_last_24h: number;
  note: string;
}

function StatusBadge({ status }: { status: Service["status"] }) {
  const colors: Record<Service["status"], string> = {
    ok: "#10b981",
    partial: "#f59e0b",
    error: "#ef4444",
  };
  const labels: Record<Service["status"], string> = {
    ok: "Online",
    partial: "Partial",
    error: "Error",
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        fontSize: "0.75rem",
        fontWeight: 600,
        backgroundColor: `${colors[status]}20`,
        color: colors[status],
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: colors[status],
          display: "inline-block",
        }}
      />
      {labels[status]}
    </span>
  );
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/health")
      .then((r) => r.json())
      .then((d) => {
        setData(d as HealthData);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load health data");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="admin-section-loading">Checking services…</div>;
  if (error) return <div className="admin-error">{error}</div>;
  if (!data) return null;

  return (
    <div className="admin-section">
      <h1 className="admin-section-title">System Health</h1>

      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.model}</div>
          <div className="admin-stat-label">Active model</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.messages_last_24h}</div>
          <div className="admin-stat-label">Messages (last 24h)</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.errors_last_24h}</div>
          <div className="admin-stat-label">Errors (last 24h)</div>
        </div>
      </div>

      {data.note && <p className="admin-section-note">{data.note}</p>}

      <div className="admin-service-grid">
        {data.services.map((svc) => (
          <div key={svc.name} className="admin-card" style={{ gap: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {svc.name}
              </h3>
              <StatusBadge status={svc.status} />
            </div>
            <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {svc.detail}
            </p>
            {svc.members && (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {svc.members.map((m) => (
                  <div
                    key={m.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.8125rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span>{m.name}</span>
                    <span
                      style={{
                        color: m.connected
                          ? m.token_expired
                            ? "#f59e0b"
                            : "#10b981"
                          : "#ef4444",
                        fontWeight: 500,
                      }}
                    >
                      {m.connected ? (m.token_expired ? "Token expired" : "Connected") : "Not connected"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: "0.75rem", color: "var(--text-tertiary)" }}>
              Checked {new Date(svc.checked_at).toLocaleTimeString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
