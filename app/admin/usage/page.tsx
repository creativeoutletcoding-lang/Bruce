"use client";

import { useEffect, useState } from "react";

interface MemberCount {
  user_id: string;
  name: string;
  count: number;
}

interface UsageData {
  period: string;
  messages_total: number;
  messages_by_member: MemberCount[];
  files_attached: number;
  estimated_api_cost_usd: number;
  cost_breakdown: {
    chat_api: number;
    hosting_note: string;
    database_note: string;
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
          <div className="admin-stat-value">${data.estimated_api_cost_usd.toFixed(2)}</div>
          <div className="admin-stat-label">Est. API cost (Anthropic)</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-value">{data.files_attached}</div>
          <div className="admin-stat-label">Files attached this month</div>
        </div>
      </div>

      <div className="admin-card">
        <h2 className="admin-card-title">Message Volume by Member</h2>
        {data.messages_by_member.length === 0 ? (
          <p className="admin-empty">No messages this month.</p>
        ) : (
          <div className="admin-bar-chart">
            {data.messages_by_member.map((m) => (
              <div key={m.user_id} className="admin-bar-col">
                <span className="admin-bar-count">{m.count}</span>
                <div
                  className="admin-bar"
                  style={{ height: `${Math.max((m.count / maxCount) * 100, 4)}px` }}
                />
                <span className="admin-bar-label">{m.name}</span>
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
              <th>Item</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Anthropic API (est.)
                <span className="admin-table-note"> — ~$0.012/message at claude-sonnet-4-6 rates</span>
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                ${data.cost_breakdown.chat_api.toFixed(2)}
              </td>
            </tr>
            <tr>
              <td>
                Hosting (Vercel)
                <span className="admin-table-note"> — {data.cost_breakdown.hosting_note}</span>
              </td>
              <td style={{ textAlign: "right", color: "var(--text-tertiary)" }}>fixed</td>
            </tr>
            <tr>
              <td>
                Database (Supabase)
                <span className="admin-table-note"> — {data.cost_breakdown.database_note}</span>
              </td>
              <td style={{ textAlign: "right", color: "var(--text-tertiary)" }}>fixed</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
