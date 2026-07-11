import assert from "node:assert/strict";
import test from "node:test";
import { loadThemeMode } from "./usePersistentThemeMode";

test("uses the night theme outside the browser", () => {
  assert.equal(loadThemeMode(), "night");
});
