import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactCancelledBranchRuns,
  getValidBranchRunRollback,
  mergeBranchSelectionsForClientSave,
  normalizeBranchRunRollback,
  preserveBranchRunLifecycleForClientSave,
  restoreMissingCancelledBranchTombstones,
  type BranchRunLifecycleMessage,
  type BranchRunLifecycleSession,
  type BranchRunRollback
} from "./sessionBranchRunLifecycle.js";
import { mergeClientSaveState } from "./sessions.js";

type TestMessage = BranchRunLifecycleMessage & {
  branchAnchor?: boolean;
  reasoning?: string;
};

type TestSession = BranchRunLifecycleSession & {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: TestMessage[];
  files: [];
};

function rollback(
  variantId = "variant-2",
  fallbackVariantId: string | undefined = "variant-1",
  runId = `run-${variantId}`
): BranchRunRollback {
  return {
    runId,
    groupId: "group-1",
    variantId,
    fallbackVariantId
  };
}

function variantMessage(
  id: string,
  role: "user" | "assistant",
  variantId: string,
  content = id
): TestMessage {
  return {
    id,
    role,
    content,
    branchGroupId: "group-1",
    branchVariantId: variantId,
    ...(role === "assistant" ? { branchAnchor: true } : {})
  };
}

function terminalBranchAssistant(
  id: string,
  outcome: "complete" | "error" | "cancelled",
  descriptor = rollback()
): TestMessage {
  return {
    ...variantMessage(id, "assistant", descriptor.variantId, "terminal content"),
    reasoning: "must be removed from a tombstone",
    branchRunRollback: descriptor,
    generationRunId: descriptor.runId,
    streamSequence: 8,
    generationOutcome: outcome,
    status: outcome === "error" ? "error" : "complete"
  };
}

function session(
  messages: TestMessage[],
  branchSelections: Record<string, string> | undefined = {
    "group-1": "variant-2"
  },
  updatedAt = 1
): TestSession {
  return {
    id: "session-1",
    title: "Session",
    createdAt: 1,
    updatedAt,
    branchSelections,
    messages,
    files: []
  };
}

function minimalTombstone(
  id = "assistant-2",
  descriptor = rollback()
): TestMessage {
  return {
    id,
    role: "assistant",
    content: "",
    generationRunId: descriptor.runId,
    streamSequence: 8,
    generationOutcome: "cancelled",
    status: "complete",
    branchRunRollback: descriptor
  };
}

describe("server branch run lifecycle", () => {
  it("normalizes rollback identity before it reaches lifecycle decisions", () => {
    assert.deepEqual(
      normalizeBranchRunRollback({
        runId: " run-2 ",
        groupId: " group-1 ",
        variantId: " variant-2 ",
        fallbackVariantId: " variant-1 "
      }),
      rollback("variant-2", "variant-1", "run-2")
    );
    assert.equal(
      normalizeBranchRunRollback({
        runId: "run-2",
        groupId: "group-1"
      }),
      undefined
    );
    assert.equal(normalizeBranchRunRollback([]), undefined);
  });

  it("compacts only the cancelled variant into a minimal durable tombstone", () => {
    const original = variantMessage(
      "assistant-1",
      "assistant",
      "variant-1",
      "Original"
    );
    const third = variantMessage(
      "assistant-3",
      "assistant",
      "variant-3",
      "Third"
    );
    const compacted = compactCancelledBranchRuns(
      session([
        original,
        variantMessage("user-2", "user", "variant-2"),
        terminalBranchAssistant("assistant-2", "cancelled"),
        variantMessage("user-3", "user", "variant-3"),
        third
      ])
    );

    assert.deepEqual(
      compacted.messages.map((message) => message.id),
      ["assistant-1", "assistant-2", "user-3", "assistant-3"]
    );
    assert.deepEqual(compacted.messages[1], minimalTombstone());
    assert.equal(compacted.branchSelections?.["group-1"], "variant-1");
    assert.equal(compacted.messages[0], original);
    assert.equal(compacted.messages[3], third);
  });

  it("leaves complete and error branch runs intact", () => {
    for (const outcome of ["complete", "error"] as const) {
      const input = session([
        variantMessage("assistant-1", "assistant", "variant-1"),
        variantMessage("user-2", "user", "variant-2"),
        terminalBranchAssistant("assistant-2", outcome)
      ]);
      assert.equal(compactCancelledBranchRuns(input), input);
      assert.equal(input.messages[2].generationOutcome, outcome);
    }
  });

  it("does not let an old rollback cancel a later run on the same assistant", () => {
    const oldRollback = rollback("variant-2", "variant-1", "run-old");
    const reused = {
      ...terminalBranchAssistant("assistant-2", "cancelled", oldRollback),
      generationRunId: "run-new"
    };
    const input = session([
      variantMessage("assistant-1", "assistant", "variant-1"),
      variantMessage("user-2", "user", "variant-2"),
      reused
    ]);

    assert.equal(getValidBranchRunRollback(reused), undefined);
    assert.equal(compactCancelledBranchRuns(input), input);
    assert.deepEqual(
      input.messages.map((message) => message.id),
      ["assistant-1", "user-2", "assistant-2"]
    );
  });

  it("repairs selection across multiple cancelled variants", () => {
    const secondRollback = rollback("variant-2", "variant-1");
    const thirdRollback = rollback("variant-3", "variant-2");
    const compacted = compactCancelledBranchRuns(
      session(
        [
          variantMessage("assistant-1", "assistant", "variant-1"),
          variantMessage("user-2", "user", "variant-2"),
          terminalBranchAssistant(
            "assistant-2",
            "cancelled",
            secondRollback
          ),
          variantMessage("user-3", "user", "variant-3"),
          terminalBranchAssistant(
            "assistant-3",
            "cancelled",
            thirdRollback
          )
        ],
        { "group-1": "variant-3" }
      )
    );

    assert.deepEqual(
      compacted.messages.map((message) => message.id),
      ["assistant-1", "assistant-2", "assistant-3"]
    );
    assert.equal(compacted.branchSelections?.["group-1"], "variant-1");
  });

  it("removes a selection when no live fallback variant remains", () => {
    const compacted = compactCancelledBranchRuns(
      session(
        [
          variantMessage("user-2", "user", "variant-2"),
          terminalBranchAssistant("assistant-2", "cancelled")
        ],
        { "group-1": "variant-2", "other-group": "other-variant" }
      )
    );

    assert.deepEqual(compacted.branchSelections, {
      "other-group": "other-variant"
    });
    assert.deepEqual(compacted.messages, [minimalTombstone()]);
  });

  it("is idempotent after cancellation has been compacted", () => {
    const once = compactCancelledBranchRuns(
      session([
        variantMessage("assistant-1", "assistant", "variant-1"),
        variantMessage("user-2", "user", "variant-2"),
        terminalBranchAssistant("assistant-2", "cancelled")
      ])
    );
    const twice = compactCancelledBranchRuns(once);

    assert.deepEqual(twice, once);
    assert.deepEqual(twice.messages[1], minimalTombstone());
  });

  it("restores a missing tombstone at its durable relative position once", () => {
    const before = variantMessage("assistant-1", "assistant", "variant-1");
    const tombstone = minimalTombstone();
    const after = variantMessage("assistant-3", "assistant", "variant-3");

    const restored = restoreMissingCancelledBranchTombstones(
      [before, tombstone, after],
      [before, after]
    );
    assert.deepEqual(
      restored.map((message) => message.id),
      ["assistant-1", "assistant-2", "assistant-3"]
    );
    assert.equal(restored[1], tombstone);
    assert.deepEqual(
      restoreMissingCancelledBranchTombstones(
        [before, tombstone, after],
        restored
      ),
      restored
    );
  });

  it("rejects tombstone deletion and same-run rollback tampering", () => {
    const descriptor = rollback("variant-2", "variant-1", "run-2");
    const tombstone = minimalTombstone("assistant-2", descriptor);
    const forged: TestMessage = {
      ...tombstone,
      content: "resurrected",
      generationOutcome: "complete" as const,
      branchRunRollback: rollback("variant-forged", undefined, "run-2")
    };
    assert.equal(
      preserveBranchRunLifecycleForClientSave(tombstone, forged, forged),
      tombstone
    );

    const currentPending: TestMessage = {
      ...variantMessage("assistant-2", "assistant", "variant-2"),
      generationRunId: "run-2",
      status: "streaming" as const,
      branchRunRollback: descriptor
    };
    const protectedCandidate = preserveBranchRunLifecycleForClientSave(
      currentPending,
      forged,
      forged
    );
    assert.deepEqual(protectedCandidate.branchRunRollback, descriptor);
  });

  it("allows a later run to replace an obsolete rollback descriptor", () => {
    const current = {
      ...variantMessage("assistant-2", "assistant", "variant-2"),
      generationRunId: "run-old",
      branchRunRollback: rollback("variant-2", "variant-1", "run-old")
    };
    const incoming = {
      ...current,
      generationRunId: "run-new",
      branchRunRollback: rollback("variant-3", "variant-1", "run-new")
    };

    assert.equal(
      preserveBranchRunLifecycleForClientSave(current, incoming, incoming),
      incoming
    );
  });

  it("merges selections and lets compaction repair a stale cancelled selection", () => {
    const current = session(
      [
        variantMessage("assistant-1", "assistant", "variant-1"),
        minimalTombstone()
      ],
      { "group-1": "variant-1" }
    );

    assert.deepEqual(
      mergeBranchSelectionsForClientSave(current, session([], {})),
      { "group-1": "variant-1" }
    );
    const staleCancelledSelection = mergeBranchSelectionsForClientSave(
      current,
      session([], { "group-1": "variant-2" })
    );
    assert.deepEqual(
      compactCancelledBranchRuns({
        ...current,
        branchSelections: staleCancelledSelection
      }).branchSelections,
      { "group-1": "variant-1" }
    );
    assert.deepEqual(
      mergeBranchSelectionsForClientSave(
        current,
        session([], { "group-1": "variant-3" })
      ),
      { "group-1": "variant-3" }
    );
  });
});

describe("server branch lifecycle integration with client saves", () => {
  it("does not resurrect a cancelled variant from a stale complete save", () => {
    type State = Parameters<typeof mergeClientSaveState>[0];
    type StoredMessage = State["sessions"][number]["messages"][number];
    const original = variantMessage(
      "assistant-1",
      "assistant",
      "variant-1",
      "Original"
    ) as StoredMessage;
    const tombstone = minimalTombstone() as StoredMessage;
    const current: State = {
      sessions: [
        session(
          [original as TestMessage, tombstone as TestMessage],
          { "group-1": "variant-1" },
          5
        )
      ],
      activeSessionId: "session-1"
    };
    const staleAssistant = terminalBranchAssistant(
      "assistant-2",
      "complete"
    );
    const staleIncoming: State = {
      sessions: [
        session(
          [
            original as TestMessage,
            variantMessage("user-2", "user", "variant-2"),
            staleAssistant
          ],
          { "group-1": "variant-2" },
          6
        )
      ],
      activeSessionId: "session-1"
    };

    const merged = mergeClientSaveState(current, staleIncoming);

    assert.deepEqual(
      merged.sessions[0].messages.map((message) => message.id),
      ["assistant-1", "assistant-2"]
    );
    assert.deepEqual(merged.sessions[0].messages[1], tombstone);
    assert.equal(
      merged.sessions[0].branchSelections?.["group-1"],
      "variant-1"
    );
  });
});
