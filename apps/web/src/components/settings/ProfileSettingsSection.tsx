import { Camera, Download, Eraser, LogOut, Plus, Trash2, Upload } from "lucide-react";
import type { ChangeEvent, RefObject } from "react";
import {
  MAX_MEMORY_ITEMS,
  MAX_MEMORY_ITEM_TEXT_LENGTH,
  MAX_USER_PREFERENCE_PROMPT_LENGTH,
  type ApiSettings
} from "../../core/apiSettings";
import type { AuthUser } from "../../core/cloudAuth";
import type { ProfileSettings } from "../../core/profileSettings";
import { ProfileAvatar } from "../ProfileAvatar";

type ProfileSettingsSectionProps = {
  apiSettings: ApiSettings;
  profileSettings: ProfileSettings;
  cloudEnabled: boolean;
  authUser?: AuthUser | null;
  avatarError: string | null;
  preferenceImportError: string | null;
  avatarFileInputRef: RefObject<HTMLInputElement>;
  preferenceFileInputRef: RefObject<HTMLInputElement>;
  onAvatarChange(event: ChangeEvent<HTMLInputElement>): void;
  onRemoveAvatar(): void;
  onUserPreferencePromptChange(value: string): void;
  onMemoryItemChange(id: string, text: string): void;
  onAddMemoryItem(): void;
  onDeleteMemoryItem(id: string): void;
  onImportPreferences(event: ChangeEvent<HTMLInputElement>): void;
  onExportPreferences(): void;
  onClearPreferences(): void;
  onLogout?(): void;
};

export function ProfileSettingsSection({
  apiSettings,
  profileSettings,
  cloudEnabled,
  authUser,
  avatarError,
  preferenceImportError,
  avatarFileInputRef,
  preferenceFileInputRef,
  onAvatarChange,
  onRemoveAvatar,
  onUserPreferencePromptChange,
  onMemoryItemChange,
  onAddMemoryItem,
  onDeleteMemoryItem,
  onImportPreferences,
  onExportPreferences,
  onClearPreferences,
  onLogout
}: ProfileSettingsSectionProps) {
  return (
    <>
      <div className="settings-profile-hero">
        <button
          className="settings-avatar-editor"
          type="button"
          aria-label="Change profile photo"
          onClick={() => avatarFileInputRef.current?.click()}
        >
          <ProfileAvatar
            avatarDataUrl={profileSettings.avatarDataUrl}
            size="settings"
          />
          <span className="settings-avatar-editor-icon">
            <Camera size={16} strokeWidth={2.1} aria-hidden="true" />
          </span>
        </button>
        <button
          className="settings-avatar-change-button"
          type="button"
          onClick={() => avatarFileInputRef.current?.click()}
        >
          Change photo
        </button>
        {profileSettings.avatarDataUrl ? (
          <button
            className="settings-avatar-remove-button"
            type="button"
            onClick={onRemoveAvatar}
          >
            Remove
          </button>
        ) : null}
        <input
          ref={avatarFileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={onAvatarChange}
        />
        {avatarError ? (
          <span className="settings-profile-error">{avatarError}</span>
        ) : null}
      </div>

      {cloudEnabled ? (
        <div className="settings-row">
          <span>Account</span>
          <div className="settings-account-control">
            <span className="settings-account-copy">
              {authUser?.email ?? "Not signed in"}
            </span>
            {authUser && onLogout ? (
              <button
                className="settings-small-button"
                type="button"
                onClick={onLogout}
              >
                <LogOut size={14} strokeWidth={2.1} aria-hidden="true" />
                <span>Sign out</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <label className="settings-row settings-row-textarea">
        <span>User Preference Prompt</span>
        <textarea
          value={apiSettings.userPreferencePrompt}
          maxLength={MAX_USER_PREFERENCE_PROMPT_LENGTH}
          rows={5}
          placeholder="Persistent instructions that should shape every reply."
          spellCheck={false}
          onChange={(event) => onUserPreferencePromptChange(event.target.value)}
        />
      </label>

      <div className="settings-row settings-row-textarea">
        <span>Memory Items</span>
        <div className="settings-control-stack settings-memory-list">
          {apiSettings.memoryItems.length ? (
            apiSettings.memoryItems.map((item) => (
              <div className="settings-memory-row" key={item.id}>
                <textarea
                  value={item.text}
                  maxLength={MAX_MEMORY_ITEM_TEXT_LENGTH}
                  rows={2}
                  placeholder="Stable preference or fact to remember."
                  spellCheck={false}
                  onChange={(event) =>
                    onMemoryItemChange(
                      item.id,
                      event.target.value.slice(0, MAX_MEMORY_ITEM_TEXT_LENGTH)
                    )
                  }
                />
                <button
                  className="settings-icon-button"
                  type="button"
                  aria-label="Delete memory item"
                  title="Delete memory item"
                  onClick={() => onDeleteMemoryItem(item.id)}
                >
                  <Trash2 size={14} strokeWidth={2.1} aria-hidden="true" />
                </button>
              </div>
            ))
          ) : (
            <span className="settings-empty-state">No memory items yet</span>
          )}
          <button
            className="settings-small-button settings-add-memory-button"
            type="button"
            onClick={onAddMemoryItem}
            disabled={apiSettings.memoryItems.length >= MAX_MEMORY_ITEMS}
          >
            <Plus size={14} strokeWidth={2.1} aria-hidden="true" />
            <span>Add Memory</span>
          </button>
        </div>
      </div>

      <div className="settings-row">
        <span>Preferences File</span>
        <div className="settings-control-stack">
          <div className="settings-preference-actions">
            <button
              className="settings-small-button"
              type="button"
              onClick={() => preferenceFileInputRef.current?.click()}
            >
              <Upload size={14} strokeWidth={2.1} aria-hidden="true" />
              <span>Import</span>
            </button>
            <button
              className="settings-small-button"
              type="button"
              onClick={onExportPreferences}
            >
              <Download size={14} strokeWidth={2.1} aria-hidden="true" />
              <span>Export</span>
            </button>
            <button
              className="settings-small-button"
              type="button"
              onClick={onClearPreferences}
            >
              <Eraser size={14} strokeWidth={2.1} aria-hidden="true" />
              <span>Clear</span>
            </button>
          </div>
          <input
            ref={preferenceFileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={onImportPreferences}
          />
          {preferenceImportError ? (
            <span className="settings-hint">{preferenceImportError}</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
