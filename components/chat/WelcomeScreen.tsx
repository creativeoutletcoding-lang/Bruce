"use client";

import { useState, useEffect } from "react";
import { useChatContext } from "@/components/layout/ChatShell";
import MessageInput from "./MessageInput";
import type { FileAttachment } from "./MessageInput";
import ModelPicker from "@/components/ui/ModelPicker";
import type { MoveToProjectConfig } from "./InputPlusMenu";

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
  effort?: string | null;
  onEffortChange?: (effort: string) => void;
  // Optional "add to project" entry in the + menu (hidden in incognito / no memberships).
  moveToProject?: MoveToProjectConfig;
  selectedProject?: { id: string; name: string } | null;
  onClearProject?: () => void;
}

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  if (hour < 12) return `Good morning, ${name}`;
  if (hour < 17) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
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
  effort,
  onEffortChange,
  moveToProject,
  selectedProject,
  onClearProject,
}: WelcomeScreenProps) {
  const { incognito } = useChatContext();
  const firstName = userName.split(" ")[0];
  // Greeting is computed client-side only — getGreeting uses new Date().getHours()
  // which returns UTC on the server but local time in the browser, causing React
  // hydration error #418 if computed during SSR.
  const [greeting, setGreeting] = useState(`Hi, ${firstName}`);
  useEffect(() => {
    setGreeting(getGreeting(firstName));
  }, [firstName]);

  return (
    <div style={{ ...styles.container, ...(incognito ? styles.incognitoFilter : {}) }}>
      {incognito && (
        <div style={styles.incognitoNotice}>
          Incognito — this conversation won&apos;t be saved
        </div>
      )}
      {/* Greeting occupies the flexible space above the composer. */}
      <div style={styles.greetingArea}>
        <h1 style={styles.greeting}>{greeting}</h1>
      </div>
      {/* Composer is bottom-anchored so that when the keyboard opens (the frame
          resizes) it is already at the bottom edge and rides up with the
          keyboard, rather than re-centering. Matches the Claude iOS app. */}
      <div style={styles.inputArea}>
        <div style={styles.inputWrapper}>
          <MessageInput
            value={inputValue}
            onChange={onInputChange}
            onSend={onSend}
            disabled={disabled}
            attachedFiles={attachedFiles}
            onFilesAttach={onFilesAttach}
            onFileRemove={onFileRemove}
            moveToProject={moveToProject}
            draftProject={
              selectedProject && onClearProject
                ? { name: selectedProject.name, onClear: onClearProject }
                : undefined
            }
            modelPicker={
              <ModelPicker currentModel={model} onSelect={onModelChange} currentEffort={effort} onEffortChange={onEffortChange} />
            }
          />
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
  // Flexible region above the composer — absorbs the keyboard-driven frame
  // shrink so the composer stays pinned to the bottom and rides up cleanly.
  greetingArea: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px 16px",
    overflowY: "auto",
  },
  // Bottom-anchored composer region. The composer (shared MessageInput) owns its
  // own padding (incl. env(safe-area-inset-bottom)), so it sits snug above the
  // keyboard / home indicator — identical to the in-conversation composer.
  inputArea: {
    flexShrink: 0,
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
    maxWidth: "780px",
    margin: "0 auto",
  },
};
