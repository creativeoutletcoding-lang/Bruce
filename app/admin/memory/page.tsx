"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface MemoryMetricRow {
  user_id: string;
  name: string;
  color_hex: string;
  private_core_count: number;
  private_active_count: number;
  private_archive_count: number;
  shared_count: number;
  total_count: number;
}

function Avatar({ name, colorHex }: { name: string; colorHex: string }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: "50%",
        backgroundColor: colorHex,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.8125rem",
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      {name[0].toUpperCase()}
    </div>
  );
}

export default function MemoryAdminPage() {
  const [metrics, setMetrics] = useState<MemoryMetricRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/memory/metrics")
      .then((r) => r.json())
      .then((d: { metrics: MemoryMetricRow[]; current_user_id: string; error?: string }) => {
        if (d.error) {
          setError(d.error);
        } else {
          setMetrics(d.metrics);
          setCurrentUserId(d.current_user_id);
        }
      })
      .catch(() => setError("Failed to load memory metrics"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="admin-section-loading">Loading memory metrics…</div>;
  if (error) return <div className="admin-error">{error}</div>;

  return (
    <div className="admin-section">
      <h1 className="admin-section-title">Memory</h1>
      <p className="admin-section-note">
        Aggregate counts only — no memory content is accessible here. Each member&apos;s memories are private.
      </p>

      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th style={{ textAlign: "right" }}>Core</th>
                <th style={{ textAlign: "right" }}>Active</th>
                <th style={{ textAlign: "right" }}>Archive</th>
                <th style={{ textAlign: "right" }}>Shared</th>
                <th style={{ textAlign: "right" }}>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.user_id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <Avatar name={m.name} colorHex={m.color_hex} />
                      <span style={{ fontWeight: 500 }}>{m.name}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                    {m.private_core_count}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                    {m.private_active_count}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                    {m.private_archive_count}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem" }}>
                    {m.shared_count}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: "0.875rem", fontWeight: 500 }}>
                    {m.total_count}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {m.user_id === currentUserId ? (
                      <Link
                        href="/chat"
                        className="admin-btn-secondary"
                        style={{ fontSize: "0.8125rem", padding: "4px 10px", display: "inline-block" }}
                      >
                        Manage my memories
                      </Link>
                    ) : (
                      <button
                        className="admin-btn-secondary"
                        disabled
                        style={{ fontSize: "0.8125rem", padding: "4px 10px", opacity: 0.4, cursor: "not-allowed" }}
                      >
                        Compress
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
