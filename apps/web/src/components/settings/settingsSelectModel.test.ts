import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAdjacentSettingsOptionIndex,
  getInitialSettingsOptionIndex
} from "./settingsSelectModel";

const options = [
  { value: "one" },
  { value: "two", disabled: true },
  { value: "three" }
];

describe("settings select keyboard model", () => {
  it("opens on the selected option and honors Home and End", () => {
    assert.equal(getInitialSettingsOptionIndex(options, "three"), 2);
    assert.equal(getInitialSettingsOptionIndex(options, "missing"), 0);
    assert.equal(getInitialSettingsOptionIndex(options, "three", "first"), 0);
    assert.equal(getInitialSettingsOptionIndex(options, "one", "last"), 2);
  });

  it("skips disabled options and wraps arrow navigation", () => {
    assert.equal(getAdjacentSettingsOptionIndex(options, 0, 1), 2);
    assert.equal(getAdjacentSettingsOptionIndex(options, 2, 1), 0);
    assert.equal(getAdjacentSettingsOptionIndex(options, 0, -1), 2);
  });
});
