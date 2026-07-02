import { SquarePen, Trash2 } from "lucide-react";

export type SessionListItem = {
  id: string;
  title: string;
  promptCount: number;
};

type SessionSidebarProps = {
  sessions: SessionListItem[];
  activeSessionId: string;
  isSending: boolean;
  onNewSession(): void;
  onSelectSession(id: string): void;
  onDeleteSession(id: string): void;
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
  onNewSession,
  onSelectSession,
  onDeleteSession
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
    </aside>
  );
}
