"use client";

import { useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.back()}
      style={styles.button}
      aria-label="Back"
      className="mobile-only"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="M11 4L5 9l6 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Back</span>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    display: "none", // shown via .mobile-only CSS
    alignItems: "center",
    gap: "4px",
    fontSize: "0.9375rem",
    color: "var(--accent)",
    cursor: "pointer",
    padding: "4px 0",
  },
};
