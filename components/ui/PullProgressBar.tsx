"use client";

import { ACCENT_COLOR } from "@/lib/utils/constants";

interface PullProgressBarProps {
  pullProgress: number; // 0 to 1
  refreshing: boolean;
}

export default function PullProgressBar({ pullProgress, refreshing }: PullProgressBarProps) {
  if (pullProgress === 0 && !refreshing) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "2px",
        zIndex: 20,
        overflow: "hidden",
      }}
    >
      {refreshing ? (
        <div
          className="pull-refresh-bar"
          style={{
            position: "absolute",
            top: 0,
            height: "100%",
            width: "40%",
            backgroundColor: ACCENT_COLOR,
          }}
        />
      ) : (
        <div
          style={{
            height: "100%",
            width: `${pullProgress * 100}%`,
            backgroundColor: ACCENT_COLOR,
            transition: "width 50ms linear",
          }}
        />
      )}
    </div>
  );
}
