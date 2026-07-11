import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_API_SETTINGS } from "../../core/apiSettings";
import { DEFAULT_DISPLAY_SETTINGS } from "../../core/displaySettings";
import { DEFAULT_PROFILE_SETTINGS } from "../../core/profileSettings";
import { DEFAULT_SEARCH_SETTINGS } from "../../core/searchSettings";
import {
  coerceSettingsSection,
  commitSettingsDrafts,
  getSettingsSectionTitle
} from "./settingsDialogModel";

describe("settings dialog model", () => {
  it("keeps billing available only while cloud features are enabled", () => {
    assert.equal(coerceSettingsSection("billing", true), "billing");
    assert.equal(coerceSettingsSection("billing", false), "profile");
    assert.equal(coerceSettingsSection("search", false), "search");
  });

  it("provides the stable section headings used by the dialog", () => {
    assert.equal(getSettingsSectionTitle("profile"), "Personal");
    assert.equal(getSettingsSectionTitle("api"), "Providers");
    assert.equal(getSettingsSectionTitle("billing"), "Billing");
    assert.equal(getSettingsSectionTitle("display"), "Display");
    assert.equal(getSettingsSectionTitle("search"), "Web Search");
  });

  it("commits each settings category exactly once without transforming drafts", () => {
    const calls: Array<[string, unknown]> = [];
    const drafts = {
      api: { ...DEFAULT_API_SETTINGS, model: "draft-model" },
      search: { ...DEFAULT_SEARCH_SETTINGS, enabled: true },
      display: { ...DEFAULT_DISPLAY_SETTINGS, showRawStream: true },
      profile: { ...DEFAULT_PROFILE_SETTINGS, avatarDataUrl: "data:image/png;base64,x" }
    };

    commitSettingsDrafts(drafts, {
      onApiSettingsChange: (settings) => calls.push(["api", settings]),
      onSearchSettingsChange: (settings) => calls.push(["search", settings]),
      onDisplaySettingsChange: (settings) => calls.push(["display", settings]),
      onProfileSettingsChange: (settings) => calls.push(["profile", settings])
    });

    assert.deepEqual(calls, [
      ["api", drafts.api],
      ["search", drafts.search],
      ["display", drafts.display],
      ["profile", drafts.profile]
    ]);
  });
});
