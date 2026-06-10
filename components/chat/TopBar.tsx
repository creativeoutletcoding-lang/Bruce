"use client";

import { useRouter } from "next/navigation";
import { useChatContext } from "@/components/layout/ChatShell";
import ModelPicker from "@/components/ui/ModelPicker";
import ChatTopBar from "./ChatTopBar";

interface TopBarProps {
  title: string;
  hasMessages: boolean;
  onRefresh?: () => void | Promise<void>;
  model?: string;
  onModelChange?: (id: string) => void;
  /** When the chat belongs to a project, renders a "[Project] / [Chat]" breadcrumb. */
  projectName?: string | null;
}

export default function TopBar({ title, hasMessages, onRefresh, model, onModelChange, projectName }: TopBarProps) {
  const router = useRouter();
  const { openDrawer, incognito, setIncognito } = useChatContext();

  function handleIncognitoToggle() {
    if (incognito) {
      setIncognito(false);
      return;
    }
    if (hasMessages) {
      setIncognito(true);
      router.push("/chat");
    } else {
      setIncognito(true);
    }
  }

  const leftButton = !hasMessages ? (
    <button
      onClick={openDrawer}
      style={styles.iconButton}
      aria-label="Open menu"
      className="mobile-only"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M2 4h14M2 9h14M2 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  ) : (
    <button
      onClick={() => router.push("/chat")}
      style={styles.iconButton}
      aria-label="Back"
      className="mobile-only"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M11 4L5 9l6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  const rightCluster = (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="icon-btn" style={styles.refreshButton}
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      )}

      {model && onModelChange && (
        <ModelPicker currentModel={model} onSelect={onModelChange} />
      )}

      <button
        onClick={handleIncognitoToggle}
        className="hover-wash"
        style={{
          ...styles.incognitoButton,
          ...(incognito ? styles.incognitoButtonActive : {}),
        }}
        aria-label={incognito ? "Disable incognito" : "Enable incognito"}
        title={incognito ? "Incognito on" : "Incognito off"}
      >
        {incognito ? <EyeSlashIcon /> : <EyeIcon />}
        <span style={styles.incognitoLabel}>Incognito</span>
      </button>
    </div>
  );

  const titleNode = projectName ? (
    <span style={styles.breadcrumb}>
      <span style={styles.crumbProject}>{projectName}</span>
      <span style={styles.crumbSep}>/</span>
      <span style={styles.crumbChat}>{title}</span>
    </span>
  ) : (
    title
  );

  return (
    <ChatTopBar
      left={leftButton}
      title={titleNode}
      right={rightCluster}
    />
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M13 2v4h-4M2 13v-4h4M2.5 9a5.5 5.5 0 0 0 10 1.5M12.5 6A5.5 5.5 0 0 0 2.5 7.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M7.5 3C4.5 3 2 5.5 1 7.5c1 2 3.5 4.5 6.5 4.5s5.5-2.5 6.5-4.5C13 5.5 10.5 3 7.5 3Z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <circle cx="7.5" cy="7.5" r="1.75" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function EyeSlashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <path
        d="M2 2l11 11M7.5 3C4.5 3 2 5.5 1 7.5c.5 1 1.5 2.25 3 3.25M9.5 4.5C11 5.5 13 6.75 14 7.5c-1 2-3.5 4.5-6.5 4.5a6.5 6.5 0 0 1-2-.3"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  breadcrumb: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    overflow: "hidden",
  },
  crumbProject: {
    color: "var(--text-tertiary)",
    fontWeight: 500,
    flexShrink: 0,
    maxWidth: "45%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  crumbSep: {
    color: "var(--text-tertiary)",
    flexShrink: 0,
  },
  crumbChat: {
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  iconButton: {
    display: "none", // shown via CSS in globals for mobile-only
    flexShrink: 0,
    width: "32px",
    height: "32px",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)",
    borderRadius: "var(--radius-sm)",
    cursor: "pointer",
  },
  incognitoButton: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    padding: "5px 9px",
    borderRadius: "var(--radius-full)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
    fontSize: "0.8125rem",
    fontWeight: "400",
    cursor: "pointer",
    transition: "color var(--transition), border-color var(--transition), background-color var(--transition)",
    flexShrink: 0,
  },
  incognitoButtonActive: {
    color: "var(--text-primary)",
    borderColor: "var(--border-strong)",
    backgroundColor: "var(--bg-secondary)",
  },
  incognitoLabel: {
    lineHeight: 1,
  },
  refreshButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "var(--radius-sm)",
    color: "var(--text-tertiary)",
    cursor: "pointer",
    flexShrink: 0,
    transition: "color var(--transition)",
  },
};
