import {
  CreditCard,
  Eye,
  KeyRound,
  LogIn,
  Search,
  UserRound,
  X
} from "lucide-react";
import type { AuthUser } from "../../core/cloudAuth";
import type { SettingsSection } from "../../features/settings/settingsDialogModel";
import packageJson from "../../../package.json";

const APP_VERSION = packageJson.version;
const APP_COMMIT =
  typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "development";

type SettingsNavigationProps = {
  section: SettingsSection;
  cloudEnabled: boolean;
  authUser?: AuthUser | null;
  onSectionChange(section: SettingsSection): void;
  onLoginRequest?(): void;
  onClose(): void;
};

export function SettingsNavigation({
  section,
  cloudEnabled,
  authUser,
  onSectionChange,
  onLoginRequest,
  onClose
}: SettingsNavigationProps) {
  return (
    <aside className="settings-nav" aria-label="Settings sections">
      <button
        className="settings-close-button"
        type="button"
        aria-label="Close settings"
        onClick={onClose}
      >
        <X size={17} strokeWidth={2.1} aria-hidden="true" />
      </button>
      <button
        className={`settings-nav-item ${
          section === "profile" ? "is-active" : ""
        }`}
        type="button"
        onClick={() => onSectionChange("profile")}
      >
        <UserRound size={18} strokeWidth={2.1} aria-hidden="true" />
        <span>Personal</span>
      </button>
      <button
        className={`settings-nav-item ${
          section === "api" ? "is-active" : ""
        }`}
        type="button"
        onClick={() => onSectionChange("api")}
      >
        <KeyRound size={18} strokeWidth={2.1} aria-hidden="true" />
        <span>Providers</span>
      </button>
      {cloudEnabled ? (
        <button
          className={`settings-nav-item ${
            section === "billing" ? "is-active" : ""
          }`}
          type="button"
          onClick={() => onSectionChange("billing")}
        >
          <CreditCard size={18} strokeWidth={2.1} aria-hidden="true" />
          <span>Billing</span>
        </button>
      ) : null}
      <button
        className={`settings-nav-item ${
          section === "display" ? "is-active" : ""
        }`}
        type="button"
        onClick={() => onSectionChange("display")}
      >
        <Eye size={18} strokeWidth={2.1} aria-hidden="true" />
        <span>Display</span>
      </button>
      <button
        className={`settings-nav-item ${
          section === "search" ? "is-active" : ""
        }`}
        type="button"
        onClick={() => onSectionChange("search")}
      >
        <Search size={18} strokeWidth={2.1} aria-hidden="true" />
        <span>Web Search</span>
      </button>
      <div className="settings-nav-footer">
        {cloudEnabled ? (
          authUser ? (
            <button
              className="settings-auth-entry is-authenticated"
              type="button"
              title={authUser.email}
              aria-label={`Open account settings for ${authUser.email}`}
              onClick={() => onSectionChange("profile")}
            >
              <UserRound size={17} strokeWidth={2.1} aria-hidden="true" />
              <span>{authUser.email}</span>
            </button>
          ) : onLoginRequest ? (
            <button
              className="settings-auth-entry"
              type="button"
              onClick={() => {
                onClose();
                onLoginRequest();
              }}
            >
              <LogIn size={17} strokeWidth={2.1} aria-hidden="true" />
              <span>Sign in</span>
            </button>
          ) : null
        ) : null}
        <div
          className="settings-build-meta"
          aria-label={`Version ${APP_VERSION}, commit ${APP_COMMIT}`}
        >
          <span>v{APP_VERSION}</span>
          <code>{APP_COMMIT}</code>
        </div>
      </div>
    </aside>
  );
}
