"use client";

import { useChatContext } from "@/components/layout/ChatShell";

interface WelcomeScreenProps {
  userName: string;
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = [
  "What should I focus on today?",
  "Draft a quick email",
  "Summarize something for me",
  "Help me think through a problem",
];

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

export default function WelcomeScreen({ userName, onSuggestion }: WelcomeScreenProps) {
  const { incognito } = useChatContext();
  const firstName = userName.split(" ")[0];
  const greeting = getGreeting(firstName);

  return (
    <div style={{ ...styles.container, ...(incognito ? styles.incognitoFilter : {}) }}>
      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}
      <div style={styles.content}>
        <h1 style={styles.greeting}>{greeting}</h1>
        <div style={styles.grid}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => onSuggestion(suggestion)}
              style={styles.card}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  incognitoFilter: {
    filter: "saturate(0.15)",
  },
  incognitoNotice: {
    padding: "8px 16px",
    fontSize: "0.8125rem",
    color: "var(--text-tertiary)",
    borderBottom: "1px solid var(--border)",
    textAlign: "center",
  },
  content: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px 40px",
    gap: "32px",
  },
  greeting: {
    fontSize: "1.5rem",
    fontWeight: "500",
    color: "var(--text-primary)",
    letterSpacing: "-0.01em",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    width: "100%",
    maxWidth: "480px",
  },
  card: {
    padding: "16px",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-primary)",
    fontSize: "0.875rem",
    fontWeight: "400",
    lineHeight: "1.4",
    textAlign: "left",
    cursor: "pointer",
    transition: "border-color var(--transition), background-color var(--transition)",
  },
};
