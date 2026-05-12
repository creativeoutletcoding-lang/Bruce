"use client";

import { useChatContext } from "@/components/layout/ChatShell";
import MessageInput from "./MessageInput";
import type { FileAttachment } from "./MessageInput";
import ModelPicker from "@/components/ui/ModelPicker";

interface WelcomeScreenProps {
  userName: string;
  inputValue: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
  attachedFiles?: FileAttachment[];
  onFilesAttach?: (files: FileAttachment[]) => void;
  onFileRemove?: (index: number) => void;
  model: string;
  onModelChange: (id: string) => void;
}

const PILLS: { label: string; text: string }[] = [
  { label: "Strategize", text: "Help me think through a strategy for " },
  { label: "Learn", text: "Explain " },
  { label: "Write", text: "Help me write " },
  { label: "Code", text: "Help me with this code: " },
  { label: "From Calendar", text: "What's on my calendar today?" },
];

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

function TargetIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 1.5V4M7 10v2.5M1.5 7H4M10 7h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 12.5C5.5 11 3.5 10.5 2 11V2.5C3.5 2 5.5 2.5 7 4M7 12.5C8.5 11 10.5 10.5 12 11V2.5C10.5 2 8.5 2.5 7 4M7 12.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PenIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M9 2.5L11.5 5l-7 7H2v-2.5l7-7z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5 4L2 7l3 3M9 4l3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 6h11M4.5 1v3M9.5 1v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function getPillIcon(label: string) {
  switch (label) {
    case "Strategize": return <TargetIcon />;
    case "Learn": return <BookIcon />;
    case "Write": return <PenIcon />;
    case "Code": return <CodeIcon />;
    case "From Calendar": return <CalendarIcon />;
    default: return null;
  }
}

export default function WelcomeScreen({
  userName,
  inputValue,
  onInputChange,
  onSend,
  disabled,
  attachedFiles,
  onFilesAttach,
  onFileRemove,
  model,
  onModelChange,
}: WelcomeScreenProps) {
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
      <div style={styles.center}>
        <div style={styles.content}>
          <h1 style={styles.greeting}>{greeting}</h1>

          <div style={styles.inputWrapper} className="welcome-input-wrapper">
            <MessageInput
              value={inputValue}
              onChange={onInputChange}
              onSend={onSend}
              disabled={disabled}
              attachedFiles={attachedFiles}
              onFilesAttach={onFilesAttach}
              onFileRemove={onFileRemove}
              containerStyle={styles.inputContainer}
              modelPicker={
                <ModelPicker currentModel={model} onSelect={onModelChange} />
              }
            />
          </div>

          <div style={styles.pillsRow} className="welcome-pills-row">
            {PILLS.map((pill) => (
              <button
                key={pill.label}
                className="welcome-pill"
                onClick={() => onInputChange(pill.text)}
                type="button"
              >
                {getPillIcon(pill.label)}
                {pill.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    minHeight: 0,
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
    flexShrink: 0,
  },
  center: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px 40px",
    overflowY: "auto",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
    width: "100%",
    maxWidth: "640px",
  },
  greeting: {
    fontSize: "1.875rem",
    fontWeight: "400",
    color: "var(--text-primary)",
    letterSpacing: "-0.02em",
    textAlign: "center",
    margin: 0,
  },
  inputWrapper: {
    width: "100%",
  },
  inputContainer: {
    borderTop: "none",
    padding: "0",
    backgroundColor: "transparent",
  },
  pillsRow: {
    display: "flex",
    gap: "8px",
    overflowX: "auto",
    width: "100%",
    paddingBottom: "2px",
  },
};
