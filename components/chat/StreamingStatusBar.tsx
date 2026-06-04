"use client";

import dynamic from "next/dynamic";
import type { TaskProgressData } from "@/lib/chat/taskProgress";

const TaskCard = dynamic(() => import("./TaskCard"), { ssr: false });

interface StreamingStatusBarProps {
  streamingStatus: string;
  taskProgress: TaskProgressData | null;
  isStreaming: boolean;
}

export default function StreamingStatusBar({ streamingStatus, taskProgress, isStreaming }: StreamingStatusBarProps) {
  // Gone — not streaming and nothing to show
  if (!isStreaming && !streamingStatus) return null;
  // Idle — streaming started but nothing queued yet
  if (!streamingStatus && !taskProgress) return null;

  return (
    <div style={styles.bar}>
      {taskProgress ? (
        <TaskCard data={taskProgress} isStreaming={isStreaming} />
      ) : (
        <span style={{ ...styles.statusText, animation: "pulse 2s ease-in-out infinite" }}>
          {streamingStatus}
        </span>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    flexShrink: 0,
    padding: "4px 16px 8px",
    width: "100%",
    maxWidth: 780,
    marginLeft: "auto",
    marginRight: "auto",
  },
  statusText: {
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    lineHeight: 1.4,
  },
};
