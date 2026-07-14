import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StreamUiPromptAction } from "../../runtime/streamui/types";
import { dispatchPreviewPromptAction } from "./previewPromptAction";

describe("preview prompt action", () => {
  it("dispatches the prompt before immediately settling its capability", () => {
    const events: string[] = [];
    const actions: StreamUiPromptAction[] = [];

    dispatchPreviewPromptAction(
      {
        capabilityId: "capability-1",
        label: "  Continue  ",
        prompt: "  Finish the artifact  "
      },
      (action) => {
        events.push("action");
        actions.push(action);
      },
      (capabilityId) => events.push(`settled:${capabilityId}`)
    );

    assert.deepEqual(events, ["action", "settled:capability-1"]);
    assert.deepEqual(actions, [
      {
        type: "prompt",
        prompt: "Finish the artifact",
        capabilityId: "capability-1",
        label: "Continue"
      }
    ]);
  });

  it("settles the capability when downstream dispatch throws", () => {
    const failure = new Error("dispatch failed");
    const settled: string[] = [];

    assert.throws(
      () =>
        dispatchPreviewPromptAction(
          { capabilityId: "capability-2", prompt: "Continue" },
          () => {
            throw failure;
          },
          (capabilityId) => settled.push(capabilityId)
        ),
      failure
    );
    assert.deepEqual(settled, ["capability-2"]);
  });

  it("settles an identified request even when its prompt is empty", () => {
    let dispatchCount = 0;
    const settled: string[] = [];

    dispatchPreviewPromptAction(
      { capabilityId: "capability-3", prompt: "  " },
      () => {
        dispatchCount += 1;
      },
      (capabilityId) => settled.push(capabilityId)
    );

    assert.equal(dispatchCount, 0);
    assert.deepEqual(settled, ["capability-3"]);
  });
});
