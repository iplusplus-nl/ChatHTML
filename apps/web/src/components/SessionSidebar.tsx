import { useEffect, useState } from "react";
import {
  Bug,
  Menu,
  MoreHorizontal,
  PanelLeftOpen,
  SquarePen,
  Trash2,
  X
} from "lucide-react";
import type { ApiSettings } from "../core/apiSettings";
import type { AuthUser } from "../core/cloudAuth";
import type { DisplaySettings } from "../core/displaySettings";
import type { ProfileSettings } from "../core/profileSettings";
import type { RuntimeSettingsSummary } from "../core/runtimeSettings";
import type { SearchSettings } from "../core/searchSettings";
import type { SettingsSection } from "../features/settings/settingsDialogModel";
import { ProfileAvatar } from "./ProfileAvatar";
import { SettingsDialog } from "./SettingsDialog";

export type ThemeMode = "day" | "night";

export type SessionListItem = {
  id: string;
  title: string;
};

const COMPACT_SIDEBAR_QUERY = "(max-width: 720px), (orientation: portrait)";

function getInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.matchMedia(COMPACT_SIDEBAR_QUERY).matches;
}

type SessionSidebarProps = {
  sessions: SessionListItem[];
  activeSessionId: string;
  isSending: boolean;
  isSessionSelectionBlocked: boolean;
  themeMode: ThemeMode;
  apiSettings: ApiSettings;
  searchSettings: SearchSettings;
  displaySettings: DisplaySettings;
  profileSettings: ProfileSettings;
  runtimeSettings: RuntimeSettingsSummary | null;
  cloudEnabled?: boolean;
  authUser?: AuthUser | null;
  onNewSession(): void;
  onSelectSession(id: string): void;
  onDeleteSession(id: string): void;
  onApiSettingsChange(settings: ApiSettings): void;
  onSearchSettingsChange(settings: SearchSettings): void;
  onDisplaySettingsChange(settings: DisplaySettings): void;
  onProfileSettingsChange(settings: ProfileSettings): void;
  onAuthUserChange?(user: AuthUser): void;
  onLoginRequest?(): void;
  onLogout?(): void;
  onBugReportOpen(): void;
};

export function SessionSidebar({
  sessions,
  activeSessionId,
  isSending,
  isSessionSelectionBlocked,
  themeMode,
  apiSettings,
  searchSettings,
  displaySettings,
  profileSettings,
  runtimeSettings,
  cloudEnabled = false,
  authUser,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onApiSettingsChange,
  onSearchSettingsChange,
  onDisplaySettingsChange,
  onProfileSettingsChange,
  onAuthUserChange,
  onLoginRequest,
  onLogout,
  onBugReportOpen
}: SessionSidebarProps) {
  const [isCompactSidebar, setIsCompactSidebar] = useState(
    getInitialSidebarCollapsed
  );
  const [isCollapsed, setIsCollapsed] = useState(getInitialSidebarCollapsed);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("profile");
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia(COMPACT_SIDEBAR_QUERY);
    const updateCompactSidebarState = () => {
      setIsCompactSidebar(mediaQuery.matches);
      if (mediaQuery.matches) {
        setIsCollapsed(true);
      }
    };

    updateCompactSidebarState();
    mediaQuery.addEventListener("change", updateCompactSidebarState);

    return () => {
      mediaQuery.removeEventListener("change", updateCompactSidebarState);
    };
  }, []);

  useEffect(() => {
    if (isSending) {
      setOpenSessionMenuId(null);
    }
  }, [isSending]);

  return (
    <aside
      className={`history-sidebar ${isCollapsed ? "is-collapsed" : ""}`}
      aria-label="Session history"
    >
      {isCollapsed ? (
        <>
          <div className="collapsed-sidebar-top">
            <button
              className="collapsed-sidebar-button"
              type="button"
              aria-label="Expand sidebar"
              onClick={() => setIsCollapsed(false)}
            >
              {isCompactSidebar ? (
                <Menu size={24} strokeWidth={2} aria-hidden="true" />
              ) : (
                <PanelLeftOpen size={21} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            <button
              className="collapsed-sidebar-button"
              type="button"
              disabled={isSending}
              aria-label="New session"
              onClick={() => {
                if (isCompactSidebar) {
                  setIsCollapsed(true);
                }
                onNewSession();
              }}
            >
              <SquarePen size={21} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          <div className="collapsed-sidebar-spacer" />
          <div className="collapsed-sidebar-bottom">
            <button
              className="sidebar-profile-button is-collapsed"
              type="button"
              aria-label="Open personal settings"
              title="Personal settings"
              onClick={() => setIsSettingsOpen(true)}
            >
              <ProfileAvatar avatarDataUrl={profileSettings.avatarDataUrl} />
            </button>
            <button
              className="collapsed-sidebar-button"
              type="button"
              aria-label="Bug Report"
              title="Bug Report"
              onClick={onBugReportOpen}
            >
              <Bug size={21} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="sidebar-header">
            <div className="sidebar-brand-row">
              <span className="sidebar-brand">ChatHTML</span>
              <button
                className="sidebar-collapse-button"
                type="button"
                aria-label="Collapse sidebar"
                onClick={() => {
                  setOpenSessionMenuId(null);
                  setIsCollapsed(true);
                }}
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <button
              className="new-session-button"
              type="button"
              disabled={isSending}
              onClick={() => {
                if (isCompactSidebar) {
                  setIsCollapsed(true);
                }
                onNewSession();
              }}
            >
              <SquarePen size={17} strokeWidth={2.1} aria-hidden="true" />
              <span>New Session</span>
            </button>
          </div>

          <nav className="session-list" aria-label="Saved sessions">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-list-item ${
                  session.id === activeSessionId ? "is-active" : ""
                } ${openSessionMenuId === session.id ? "is-menu-open" : ""}`}
              >
                <button
                  className="session-select-button"
                  type="button"
                  disabled={isSessionSelectionBlocked}
                  aria-current={
                    session.id === activeSessionId ? "page" : undefined
                  }
                  onClick={() => {
                    setOpenSessionMenuId(null);
                    if (isCompactSidebar) {
                      setIsCollapsed(true);
                    }
                    onSelectSession(session.id);
                  }}
                >
                  <span className="session-title">{session.title}</span>
                </button>
                <button
                  className="session-actions-button"
                  type="button"
                  disabled={isSending}
                  aria-label={`Session actions: ${session.title}`}
                  aria-expanded={openSessionMenuId === session.id}
                  onClick={() =>
                    setOpenSessionMenuId((current) =>
                      current === session.id ? null : session.id
                    )
                  }
                >
                  <MoreHorizontal size={17} strokeWidth={2.1} aria-hidden="true" />
                </button>
                {openSessionMenuId === session.id ? (
                  <div className="session-menu-popover" role="menu">
                    <button
                      className="session-menu-item is-danger"
                      type="button"
                      role="menuitem"
                      disabled={isSending}
                      onClick={() => {
                        setOpenSessionMenuId(null);
                        onDeleteSession(session.id);
                      }}
                    >
                      <Trash2 size={16} strokeWidth={2.1} aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button
              className="sidebar-profile-button"
              type="button"
              aria-label="Open personal settings"
              title={authUser?.email || "Personal settings"}
              onClick={() => setIsSettingsOpen(true)}
            >
              <ProfileAvatar avatarDataUrl={profileSettings.avatarDataUrl} />
            </button>
            <button
              className="sidebar-icon-button"
              type="button"
              aria-label="Bug Report"
              title="Bug Report"
              onClick={onBugReportOpen}
            >
              <Bug size={17} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>
        </>
      )}

      {isSettingsOpen ? (
        <SettingsDialog
          section={settingsSection}
          themeMode={themeMode}
          apiSettings={apiSettings}
          searchSettings={searchSettings}
          displaySettings={displaySettings}
          profileSettings={profileSettings}
          runtimeSettings={runtimeSettings}
          cloudEnabled={cloudEnabled}
          authUser={authUser}
          onClose={() => setIsSettingsOpen(false)}
          onSectionChange={setSettingsSection}
          onApiSettingsChange={onApiSettingsChange}
          onSearchSettingsChange={onSearchSettingsChange}
          onDisplaySettingsChange={onDisplaySettingsChange}
          onProfileSettingsChange={onProfileSettingsChange}
          onAuthUserChange={onAuthUserChange}
          onLoginRequest={onLoginRequest}
          onLogout={onLogout}
        />
      ) : null}
    </aside>
  );
}
