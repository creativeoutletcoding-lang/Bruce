"use client";

import { useState } from "react";
import type { TaskProgressData, TaskStep } from "@/lib/chat/taskProgress";

export type { TaskProgressData, TaskStep };

interface TaskCardProps {
  data: TaskProgressData;
  isStreaming?: boolean;
}

type OverallStatus = "in_progress" | "done" | "error";

function getOverallStatus(steps: TaskStep[]): OverallStatus {
  if (steps.some((s) => s.status === "error")) return "error";
  if (steps.length > 0 && steps.every((s) => s.status === "done")) return "done";
  return "in_progress";
}

function StepIcon({ status }: { status: TaskStep["status"] }) {
  if (status === "done") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "#22c55e" }}>
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5 8.5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "#ef4444" }}>
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "working") {
    return (
      <div
        aria-label="Working"
        style={{
          width: "16px",
          height: "16px",
          minWidth: "16px",
          borderRadius: "50%",
          border: "1.5px solid var(--accent, #0F6E56)",
          borderTopColor: "transparent",
          animation: "taskSpin 0.75s linear infinite",
        }}
      />
    );
  }
  if (status === "cancelled") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--border-strong)" }}>
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
        <path d="M5.5 8h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  // pending
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--border-strong)" }}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export default function TaskCard({ data, isStreaming = false }: TaskCardProps) {
  const overall = getOverallStatus(data.steps);
  const [expanded, setExpanded] = useState(false);

  const isDone = overall === "done" && !isStreaming;
  const isError = overall === "error";
  const showSteps = !isDone || isError || expanded;

  const badgeStyle: React.CSSProperties = {
    ...styles.statusBadge,
    backgroundColor:
      overall === "done"
        ? "rgba(34,197,94,0.12)"
        : overall === "error"
        ? "rgba(239,68,68,0.12)"
        : "rgba(15,110,86,0.1)",
    color:
      overall === "done"
        ? "#16a34a"
        : overall === "error"
        ? "#dc2626"
        : "#0F6E56",
  };

  return (
    <div style={styles.card}>
      <div
        style={{ ...styles.header, cursor: isDone ? "pointer" : "default" }}
        onClick={isDone ? () => setExpanded((v) => !v) : undefined}
        role={isDone ? "button" : undefined}
        aria-expanded={isDone ? expanded : undefined}
      >
        <div style={styles.headerLeft}>
          <span style={styles.taskName}>{data.task}</span>
          <span style={badgeStyle}>
            {overall === "done"
              ? "Complete"
              : overall === "error"
              ? "Error"
              : "In progress…"}
          </span>
        </div>
        {isDone && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              color: "var(--text-tertiary)",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.18s ease",
            }}
          >
            <path
              d="M2 4.5l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {showSteps && (
        <div style={styles.stepList}>
          {data.steps.map((step) => (
            <div
              key={step.id}
              style={{
                ...styles.stepRow,
                opacity: step.status === "cancelled" ? 0.4 : 1,
              }}
            >
              <StepIcon status={step.status} />
              <div style={styles.stepContent}>
                <span
                  style={{
                    ...styles.stepLabel,
                    color:
                      step.status === "error"
                        ? "#dc2626"
                        : "var(--text-primary)",
                  }}
                >
                  {step.label}
                </span>
                {step.detail && (
                  <span style={styles.stepDetail}>{step.detail}</span>
                )}
                {step.error && (
                  <span style={{ ...styles.stepDetail, color: "#dc2626" }}>
                    {step.error}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    backgroundColor: "var(--bg-secondary)",
    overflow: "hidden",
    margin: "4px 0",
    width: "100%",
    maxWidth: "480px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    gap: "10px",
    userSelect: "none",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
    flex: 1,
    flexWrap: "wrap",
  },
  taskName: {
    fontSize: "0.8125rem",
    fontWeight: "600",
    color: "var(--text-primary)",
    lineHeight: 1.3,
  },
  statusBadge: {
    fontSize: "0.6875rem",
    fontWeight: "600",
    padding: "2px 7px",
    borderRadius: "var(--radius-full)",
    whiteSpace: "nowrap",
    flexShrink: 0,
    letterSpacing: "0.01em",
    lineHeight: 1.6,
  },
  stepList: {
    borderTop: "1px solid var(--border)",
    padding: "10px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "9px",
  },
  stepRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
  },
  stepContent: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
    paddingTop: "0px",
  },
  stepLabel: {
    fontSize: "0.8125rem",
    lineHeight: "1.4",
  },
  stepDetail: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary)",
    lineHeight: "1.4",
  },
};
