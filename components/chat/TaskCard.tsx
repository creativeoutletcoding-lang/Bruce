"use client";

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
    return <span style={{ color: "var(--accent)", fontSize: "12px", lineHeight: 1, flexShrink: 0 }}>✓</span>;
  }
  if (status === "error") {
    return <span style={{ color: "#ef4444", fontSize: "12px", lineHeight: 1, flexShrink: 0 }}>✗</span>;
  }
  if (status === "working") {
    return (
      <span
        aria-label="Working"
        style={{
          display: "inline-block",
          width: "10px",
          height: "10px",
          minWidth: "10px",
          borderRadius: "50%",
          border: "1.5px solid var(--accent)",
          borderTopColor: "transparent",
          animation: "taskSpin 0.75s linear infinite",
          flexShrink: 0,
        }}
      />
    );
  }
  // pending or cancelled
  return <span style={{ color: "var(--text-tertiary)", fontSize: "14px", lineHeight: 1, flexShrink: 0 }}>·</span>;
}

export default function TaskCard({ data, isStreaming = false }: TaskCardProps) {
  const overall = getOverallStatus(data.steps);
  const isDone = overall === "done" && !isStreaming;
  const isError = overall === "error";

  if (isDone && !isError) {
    return (
      <div style={styles.container}>
        <span style={styles.taskTitle}>{data.task}</span>
        <span style={styles.doneSep}> — </span>
        <span style={styles.doneLabel}>✓ Done</span>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {data.task && <div style={styles.taskTitle}>{data.task}</div>}
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
            <span
              style={{
                ...styles.stepLabel,
                color:
                  step.status === "working"
                    ? "var(--text-primary)"
                    : step.status === "error"
                    ? "#dc2626"
                    : "var(--text-secondary)",
              }}
            >
              {step.label}
              {step.detail && (
                <span style={styles.stepDetail}> · {step.detail}</span>
              )}
              {step.error && (
                <span style={{ ...styles.stepDetail, color: "#dc2626" }}> · {step.error}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderLeft: "2px solid rgba(15, 110, 86, 0.3)",
    background: "transparent",
    padding: "8px 0 8px 12px",
    marginBottom: "4px",
  },
  taskTitle: {
    fontSize: "12px",
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 600,
    lineHeight: "22px",
  },
  doneSep: {
    fontSize: "12px",
    color: "var(--text-tertiary)",
  },
  doneLabel: {
    fontSize: "12px",
    color: "var(--accent)",
    fontWeight: 600,
  },
  stepList: {
    display: "flex",
    flexDirection: "column",
    marginTop: "4px",
  },
  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    lineHeight: "22px",
    minHeight: "22px",
  },
  stepLabel: {
    fontSize: "13px",
    lineHeight: "22px",
  },
  stepDetail: {
    fontSize: "12px",
    color: "var(--text-tertiary)",
  },
};
