import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatSession } from "../../domain/chat/sessionModel";
import { collectChatRunCancellationTargets } from "./useChatRunCancellation";

function session(): ChatSession {
  return {
    id: "session-1",
    title: "Session",
    createdAt: 1,
    updatedAt: 1,
    files: [],
    messages: [
      {
        id: "assistant-a",
        role: "assistant",
        content: "",
        generationRunId: "run-a",
        status: "streaming"
      },
      {
        id: "assistant-complete",
        role: "assistant",
        content: "done",
        generationRunId: "run-complete",
        generationOutcome: "complete",
        status: "complete"
      }
    ]
  };
}

describe("chat run cancellation target collection", () => {
  it("collects only streaming session runs", () => {
    assert.deepEqual(collectChatRunCancellationTargets(session(), undefined), [
      {
        runId: "run-a",
        sessionId: "session-1",
        assistantId: "assistant-a"
      }
    ]);
  });

  it("adds an active visual run and deduplicates the same run id", () => {
    const visual = {
      runId: "run-visual",
      sessionId: "session-1",
      assistantId: "assistant-visual"
    };
    assert.deepEqual(collectChatRunCancellationTargets(session(), visual), [
      {
        runId: "run-a",
        sessionId: "session-1",
        assistantId: "assistant-a"
      },
      visual
    ]);

    const replacement = {
      runId: "run-a",
      sessionId: "session-1",
      assistantId: "visual-owner"
    };
    assert.deepEqual(
      collectChatRunCancellationTargets(session(), replacement),
      [replacement]
    );
  });

  it("still collects a visual run without an active session", () => {
    const visual = {
      runId: "run-visual",
      sessionId: "session-2",
      assistantId: "assistant-2"
    };
    assert.deepEqual(collectChatRunCancellationTargets(undefined, visual), [
      visual
    ]);
  });
});
