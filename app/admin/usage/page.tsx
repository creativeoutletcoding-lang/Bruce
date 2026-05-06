"use client";

import { useEffect, useState } from "react";

interface MemberCount {
  user_id: string;
  name: string;
  color_hex: string;
  count: number;
}

interface UsageData {
  period: string;
  messages_total: number;
  messages_by_member: MemberCount[];
  files_attached: number;
  images_generated: number;
  web_searches: number;
  cost_breakdown: {
    chat_api: number;
    replicate: number;
    perplexity: number;
    total: number;
  };
}

export default function UsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then((r) => r.json())
      .then((d) => {
        setData(d as UsageData);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load usage data");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="admin-section-loading">Loading…</div>;
  if (error) return <div className="admin-error">{error}</div>;
  if (!data) return null;

  const maxCount = Math.max(...data.messages_by_member.map((m) => m.count), 1);
  const [year, month] = data.period.split("-");
  const periodLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="admin-section">
      <h1 className="admin-section-title">Usage &amp; Cost — {periodLabel}</h1>
      <p className="admin-section-note">Message content is never shown. Volume and cost only.</p>

      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.messages_total.toLocaleString()}</div>
          <div className="admin-stat-label">Messages this month</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.images_generated}</div>
          <div className="admin-stat-label">Images generated</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.web_searches}</div>
          <div className="admin-stat-label">Web searches</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.files_attached}</div>
          <div className="admin-stat-label">Files attached</div>
        </div>
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">Message Volume by Member</h2>
        {data.messages_by_member.length === 0 ? (
          <p className="admin-empty">No messages this month.</p>
        ) : (
          <div className="admin-hbar-chart">
            {data.messages_by_member.map((m) => (
              <div key={m.user_id} className="admin-hbar-row">
                <span className="admin-hbar-name">{m.name}</span>
                <div className="admin-hbar-track">
                  <div
                    className="admin-hbar-fill"
                    style={{
                      width: `${Math.max((m.count / maxCount) * 100, m.count > 0 ? 2 : 0)}%`,
                      backgroundColor: m.color_hex,
                    }}
                  />
                </div>
                <span className="admin-hbar-count">{m.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">Cost Breakdown</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Service</th>
              <th style={{ textAlign: "right" }}>Est. Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Anthropic API (chat)
                <span className="admin-table-note"> — {data.messages_total} messages × ~$0.012</span>
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                ${data.cost_breakdown.chat_api.toFixed(2)}
              </td>
            </tr>
            <tr>
              <td>
                Replicate (images)
                <span className="admin-table-note"> — {data.images_generated} images × $0.003</span>
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                ${data.cost_breakdown.replicate.toFixed(2)}
              </td>
            </tr>
            <tr>
              <td>
                Perplexity (web search)
                <span className="admin-table-note"> — {data.web_searches} searches × $0.005</span>
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                ${data.cost_breakdown.perplexity.toFixed(2)}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 600, paddingTop: "14px", borderTop: "1px solid var(--border-strong)" }}>
                Total estimated this month
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, paddingTop: "14px", borderTop: "1px solid var(--border-strong)" }}>
                ${data.cost_breakdown.total.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="admin-section-note" style={{ marginTop: 0 }}>
          Estimates based on usage volume. Vercel and Supabase are on free tiers.
        </p>
      </div>
    </div>
  );
}
