import { Moon, SquarePen, Sun, Trash2 } from "lucide-react";

export type ThemeMode = "day" | "night";

export type SessionListItem = {
  id: string;
  title: string;
  promptCount: number;
};

type SessionSidebarProps = {
  sessions: SessionListItem[];
  activeSessionId: string;
  isSending: boolean;
  themeMode: ThemeMode;
  onNewSession(): void;
  onSelectSession(id: string): void;
  onDeleteSession(id: string): void;
  onThemeModeChange(mode: ThemeMode): void;
};

function formatSessionMeta(session: SessionListItem): string {
  if (session.promptCount === 0) {
    return "Empty";
  }

  return `${session.promptCount} prompt${session.promptCount === 1 ? "" : "s"}`;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  isSending,
  themeMode,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onThemeModeChange
}: SessionSidebarProps) {
  return (
    <aside className="history-sidebar" aria-label="Session history">
      <button
        className="new-session-button"
        type="button"
        disabled={isSending}
        onClick={onNewSession}
      >
        <SquarePen size={17} strokeWidth={2.1} aria-hidden="true" />
        <span>New Session</span>
      </button>

      <nav className="session-list" aria-label="Saved sessions">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`session-list-item ${
              session.id === activeSessionId ? "is-active" : ""
            }`}
          >
            <button
              className="session-select-button"
              type="button"
              disabled={isSending && session.id !== activeSessionId}
              aria-current={session.id === activeSessionId ? "page" : undefined}
              onClick={() => onSelectSession(session.id)}
            >
              <span className="session-title">{session.title}</span>
              <span className="session-meta">{formatSessionMeta(session)}</span>
            </button>
            <button
              className="session-delete-button"
              type="button"
              disabled={isSending}
              aria-label={`Delete session: ${session.title}`}
              onClick={() => onDeleteSession(session.id)}
            >
              <Trash2 size={15} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>
        ))}
      </nav>

      <div
        className="theme-toggle"
        data-mode={themeMode}
        role="group"
        aria-label="Theme"
      >
        <span className="theme-toggle-indicator" aria-hidden="true" />
        <button
          className="theme-toggle-button"
          type="button"
          aria-label="Use day theme"
          aria-pressed={themeMode === "day"}
          onClick={() => onThemeModeChange("day")}
        >
          <Sun size={15} strokeWidth={2.1} aria-hidden="true" />
        </button>
        <button
          className="theme-toggle-button"
          type="button"
          aria-label="Use night theme"
          aria-pressed={themeMode === "night"}
          onClick={() => onThemeModeChange("night")}
        >
          <Moon size={15} strokeWidth={2.1} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
