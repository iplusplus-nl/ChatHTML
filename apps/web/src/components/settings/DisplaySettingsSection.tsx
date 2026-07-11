import type { DisplaySettings } from "../../core/displaySettings";

type DisplaySettingsSectionProps = {
  settings: DisplaySettings;
  onSettingsChange(patch: Partial<DisplaySettings>): void;
};

export function DisplaySettingsSection({
  settings,
  onSettingsChange
}: DisplaySettingsSectionProps) {
  return (
    <>
      <label className="settings-row">
        <span>Direct Edit</span>
        <input
          className="settings-switch"
          type="checkbox"
          role="switch"
          checked={settings.artifactEditingEnabled}
          onChange={(event) =>
            onSettingsChange({ artifactEditingEnabled: event.target.checked })
          }
        />
      </label>
      <label className="settings-row">
        <span>Raw Stream</span>
        <input
          className="settings-checkbox"
          type="checkbox"
          checked={settings.showRawStream}
          onChange={(event) =>
            onSettingsChange({ showRawStream: event.target.checked })
          }
        />
      </label>
    </>
  );
}
