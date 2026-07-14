import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discardComposerAttachmentsAndRun } from "./composerAttachmentNavigation";

describe("composer attachment navigation", () => {
  it("discards attachments before changing sessions", async () => {
    const events: string[] = [];

    const result = discardComposerAttachmentsAndRun(
      {
        clearAttachments: async () => {
          events.push("clear");
        }
      },
      () => {
        events.push("select");
        return "selected";
      }
    );

    assert.equal(result, "selected");
    assert.deepEqual(events, ["clear", "select"]);
  });

  it("does not await attachment cleanup before navigating", () => {
    const neverSettles = new Promise<void>(() => undefined);
    let selected = false;

    discardComposerAttachmentsAndRun(
      { clearAttachments: () => neverSettles },
      () => {
        selected = true;
      }
    );

    assert.equal(selected, true);
  });

  it("does not strand navigation when attachment cleanup rejects", async () => {
    const failure = new Error("cleanup failed");
    const errors: unknown[] = [];
    let selected = false;

    discardComposerAttachmentsAndRun(
      {
        clearAttachments: async () => {
          throw failure;
        },
        onClearError: (error) => errors.push(error)
      },
      () => {
        selected = true;
      }
    );

    assert.equal(selected, true);
    await Promise.resolve();
    assert.deepEqual(errors, [failure]);
  });

  it("does not strand navigation when attachment cleanup throws synchronously", () => {
    const failure = new Error("cleanup threw");
    const errors: unknown[] = [];
    let created = false;

    discardComposerAttachmentsAndRun(
      {
        clearAttachments: () => {
          throw failure;
        },
        onClearError: (error) => errors.push(error)
      },
      () => {
        created = true;
      }
    );

    assert.equal(created, true);
    assert.deepEqual(errors, [failure]);
  });
});
