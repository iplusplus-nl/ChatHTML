import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARTIFACT_SHARE_LINK_ENVIRONMENT_KEY,
  filterUnavailableArtifactShareLink,
  isArtifactShareLinkAvailable
} from "./artifactShareLinkAvailability";

const actions = [
  { action: "copy-code", label: "Copy Code" },
  { action: "create-share-link", label: "Share Link" },
  { action: "download-html", label: "Download HTML" }
];

describe("artifact share-link availability", () => {
  it("hides the action when an external share route was not configured", () => {
    assert.equal(isArtifactShareLinkAvailable({}), false);
    assert.deepEqual(
      filterUnavailableArtifactShareLink(actions, {}).map(
        (item) => item.action
      ),
      ["copy-code", "download-html"]
    );
  });

  it("offers the action only after an explicit deployment opt-in", () => {
    for (const value of ["true", "1", "YES", " on "]) {
      const environment = {
        [ARTIFACT_SHARE_LINK_ENVIRONMENT_KEY]: value
      };
      assert.equal(isArtifactShareLinkAvailable(environment), true);
      assert.deepEqual(
        filterUnavailableArtifactShareLink(actions, environment).map(
          (item) => item.action
        ),
        ["copy-code", "create-share-link", "download-html"]
      );
    }
  });

  it("does not treat arbitrary non-empty values as configuration", () => {
    for (const value of ["false", "0", "enabled", true]) {
      assert.equal(
        isArtifactShareLinkAvailable({
          VITE_CHATHTML_ARTIFACT_SHARE_LINKS: value
        }),
        false
      );
    }
  });
});
