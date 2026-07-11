import assert from "node:assert/strict";
import { it } from "node:test";
import {
  clearIframeCaptureSource,
  getIframeCaptureSource,
  setIframeCaptureSource
} from "./iframeCaptureSource";

it("keeps static capture sources scoped to their iframe instance", () => {
  const first = {} as HTMLIFrameElement;
  const second = {} as HTMLIFrameElement;

  setIframeCaptureSource(first, "<main>first</main>");
  setIframeCaptureSource(second, "<main>second</main>");
  assert.equal(getIframeCaptureSource(first), "<main>first</main>");
  assert.equal(getIframeCaptureSource(second), "<main>second</main>");

  clearIframeCaptureSource(first);
  assert.equal(getIframeCaptureSource(first), undefined);
  assert.equal(getIframeCaptureSource(second), "<main>second</main>");
});
