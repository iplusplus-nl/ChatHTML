import { CreditCard, Eye, KeyRound, Search, UserRound, X } from "lucide-react";
import type { SettingsSection } from "../../features/settings/settingsDialogModel";
import packageJson from "../../../package.json";

const APP_VERSION = packageJson.version;
const APP_COMMIT = __APP_COMMIT__;

type SettingsNavigationProps = {
  section: SettingsSection;
  cloudEnabled: boolean;
  onSectionChange(section: SettingsSection): void;
  onClose(): void;
};

export function SettingsNavigation({
  section,
  cloudEnabled,
  onSectionChange,
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
      <div
        className="settings-build-meta"
        aria-label={`Version ${APP_VERSION}, commit ${APP_COMMIT}`}
      >
        <span>v{APP_VERSION}</span>
        <code>{APP_COMMIT}</code>
      </div>
    </aside>
  );
}
