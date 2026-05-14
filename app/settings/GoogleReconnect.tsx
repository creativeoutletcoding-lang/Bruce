"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GoogleReconnect() {
  const [loading, setLoading] = useState(false);

  async function handleReconnect() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: [
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/documents",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/presentations",
          "https://www.googleapis.com/auth/calendar",
          "https://mail.google.com/",
        ].join(" "),
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  }

  return (
    <button onClick={handleReconnect} disabled={loading} style={styles.button}>
      {loading ? "Redirecting…" : "Reconnect Google"}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  button: {
    alignSelf: "flex-start",
    padding: "9px 16px",
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-md)",
    color: "var(--text-primary)",
    fontSize: "0.875rem",
    fontWeight: "500",
    cursor: "pointer",
  },
};
