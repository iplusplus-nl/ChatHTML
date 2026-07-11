import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_API_SETTINGS } from "../core/apiSettings";
import { DEFAULT_DISPLAY_SETTINGS } from "../core/displaySettings";
import { DEFAULT_PROFILE_SETTINGS } from "../core/profileSettings";
import { DEFAULT_SEARCH_SETTINGS } from "../core/searchSettings";
import { SessionSidebar } from "./SessionSidebar";
import { SettingsNavigation } from "./settings/SettingsNavigation";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderSidebar(authenticated: boolean): string {
  return renderToStaticMarkup(
    <SessionSidebar
      sessions={[]}
      activeSessionId=""
      isSending={false}
      isSessionSelectionBlocked={false}
      themeMode="day"
      apiSettings={DEFAULT_API_SETTINGS}
      searchSettings={DEFAULT_SEARCH_SETTINGS}
      displaySettings={DEFAULT_DISPLAY_SETTINGS}
      profileSettings={DEFAULT_PROFILE_SETTINGS}
      runtimeSettings={null}
      cloudEnabled
      authUser={
        authenticated
          ? { id: "user-1", email: "user@example.com", role: "user" }
          : null
      }
      onNewSession={() => undefined}
      onSelectSession={() => undefined}
      onDeleteSession={() => undefined}
      onApiSettingsChange={() => undefined}
      onSearchSettingsChange={() => undefined}
      onDisplaySettingsChange={() => undefined}
      onProfileSettingsChange={() => undefined}
      onLoginRequest={() => undefined}
      onBugReportOpen={() => undefined}
    />
  );
}

function renderNavigation(authenticated: boolean): string {
  return renderToStaticMarkup(
    <SettingsNavigation
      section="profile"
      cloudEnabled
      authUser={
        authenticated
          ? { id: "user-1", email: "user@example.com", role: "user" }
          : null
      }
      onSectionChange={() => undefined}
      onLoginRequest={() => undefined}
      onClose={() => undefined}
    />
  );
}

describe("account entry points", () => {
  it("shows sign-in actions beside the sidebar avatar and at settings bottom", () => {
    const sidebar = renderSidebar(false);
    const settings = renderNavigation(false);

    assert.match(sidebar, /aria-label="Sign in to ChatHTML"/);
    assert.match(sidebar, />Sign in</);
    assert.match(settings, /class="settings-auth-entry"/);
    assert.match(settings, />Sign in</);
    assert.equal(settings.match(/>Sign in</g)?.length, 1);
  });

  it("replaces sign-in actions with the account email after authentication", () => {
    const sidebar = renderSidebar(true);
    const settings = renderNavigation(true);

    assert.doesNotMatch(sidebar, /aria-label="Sign in to ChatHTML"/);
    assert.doesNotMatch(settings, /class="settings-auth-entry"/);
    assert.match(sidebar, /user@example\.com/);
    assert.match(settings, /settings-auth-entry is-authenticated/);
    assert.match(settings, /user@example\.com/);
  });
});
