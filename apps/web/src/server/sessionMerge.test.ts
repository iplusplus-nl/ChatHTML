import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSessionStateKeyFromClientId,
  mergeClientSaveState
} from "../../server/sessions.js";

type StoredSessionStateForTest = Parameters<typeof mergeClientSaveState>[0];
type StoredSessionForTest = StoredSessionStateForTest["sessions"][number];
type StoredMessageForTest = StoredSessionForTest["messages"][number];

function userMessage(id: string, content: string): StoredMessageForTest {
  return {
    id,
    role: "user" as const,
    content
  };
}

function session(
  id: string,
  updatedAt: number,
  messages: StoredMessageForTest[] = []
): StoredSessionForTest {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messages,
    files: []
  };
}

function assistantWithCompletedArtifactEdit(): StoredMessageForTest {
  return {
    id: "a1",
    role: "assistant" as const,
    content: "",
    rawStream: "<chat></chat><streamui><p>Edited</p></streamui>",
    artifactEditBaseRawStream:
      "<chat></chat><streamui><p>Original</p></streamui>",
    activeArtifactEditId: "edit-1",
    artifactEdits: [
      {
        id: "edit-1",
        createdAt: 20,
        prompt: "Change copy",
        references: [],
        activeVariantId: "variant-1",
        variants: [
          {
            id: "variant-1",
            createdAt: 20,
            status: "complete",
            rawStream: "<chat></chat><streamui><p>Edited</p></streamui>"
          }
        ],
        status: "complete"
      }
    ]
  } as StoredMessageForTest;
}

describe("server session merge", () => {
  it("uses one shared anonymous state during early product development", () => {
    assert.equal(
      getSessionStateKeyFromClientId("client-test-12345678"),
      "global"
    );
    assert.equal(getSessionStateKeyFromClientId("short"), "global");
  });

  it("does not resurrect sessions deleted by another client", () => {
    const current = {
      sessions: [session("kept", 2)],
      activeSessionId: "kept",
      deletedSessionIds: ["deleted"]
    };
    const staleIncoming = {
      sessions: [session("deleted", 3), session("kept", 2)],
      activeSessionId: "deleted"
    };

    const merged = mergeClientSaveState(current, staleIncoming);

    assert.deepEqual(
      merged.sessions.map((item: { id: string }) => item.id),
      ["kept"]
    );
    assert.equal(merged.activeSessionId, "kept");
    assert.deepEqual(merged.deletedSessionIds, ["deleted"]);
  });

  it("records explicit deleted session ids as tombstones", () => {
    const current = {
      sessions: [session("deleted", 3), session("kept", 2)],
      activeSessionId: "deleted"
    };
    const incoming = {
      sessions: [session("kept", 2)],
      activeSessionId: "kept"
    };

    const merged = mergeClientSaveState(current, incoming, new Set(["deleted"]));

    assert.deepEqual(
      merged.sessions.map((item: { id: string }) => item.id),
      ["kept"]
    );
    assert.equal(merged.activeSessionId, "kept");
    assert.deepEqual(merged.deletedSessionIds, ["deleted"]);
  });

  it("does not preserve missing empty sessions during client saves", () => {
    const current = {
      sessions: [
        session("empty", 3),
        session("saved", 2, [userMessage("u1", "hello")])
      ],
      activeSessionId: "empty"
    };
    const incoming = {
      sessions: [session("saved", 4, [userMessage("u1", "hello")])],
      activeSessionId: "saved"
    };

    const merged = mergeClientSaveState(current, incoming);

    assert.deepEqual(
      merged.sessions.map((item: { id: string }) => item.id),
      ["saved"]
    );
    assert.equal(merged.activeSessionId, "saved");
  });

  it("still preserves missing non-empty sessions from other clients", () => {
    const current = {
      sessions: [
        session("other-client", 5, [userMessage("u2", "from another tab")]),
        session("saved", 2, [userMessage("u1", "hello")])
      ],
      activeSessionId: "other-client"
    };
    const incoming = {
      sessions: [session("saved", 4, [userMessage("u1", "hello")])],
      activeSessionId: "saved"
    };

    const merged = mergeClientSaveState(current, incoming);

    assert.deepEqual(
      merged.sessions.map((item: { id: string }) => item.id),
      ["other-client", "saved"]
    );
  });

  it("drops incoming empty sessions when incoming also has history", () => {
    const current = {
      sessions: [session("saved", 2, [userMessage("u1", "hello")])],
      activeSessionId: "saved"
    };
    const incoming = {
      sessions: [
        session("empty", 5),
        session("saved", 4, [userMessage("u1", "hello")])
      ],
      activeSessionId: "empty"
    };

    const merged = mergeClientSaveState(current, incoming);

    assert.deepEqual(
      merged.sessions.map((item: { id: string }) => item.id),
      ["saved"]
    );
    assert.equal(merged.activeSessionId, "saved");
  });

  it("preserves newer bug report drafts when a stale client saves", () => {
    const current = {
      sessions: [
        {
          ...session("active", 50, [userMessage("u1", "hello")]),
          bugReportDraft: {
            text: "The edit button disappears.",
            images: [],
            updatedAt: 55
          }
        }
      ],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [session("active", 40, [userMessage("u1", "hello")])],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);

    assert.equal(
      merged.sessions[0].bugReportDraft?.text,
      "The edit button disappears."
    );
  });

  it("allows a missing resumed run to be marked interrupted", () => {
    const current = {
      sessions: [
        {
          ...session("active", 2),
          messages: [
            {
              id: "a1",
              role: "assistant" as const,
              content: "",
              generationRunId: "run-1",
              streamSequence: 0,
              status: "streaming" as const
            }
          ]
        }
      ],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [
        {
          ...session("active", 3),
          messages: [
            {
              id: "a1",
              role: "assistant" as const,
              content: "I could not complete that request.",
              generationRunId: "run-1",
              streamSequence: 0,
              status: "error" as const,
              error: "The stream was interrupted before it completed."
            }
          ]
        }
      ],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);

    assert.equal(merged.sessions[0].messages[0].status, "error");
    assert.equal(
      merged.sessions[0].messages[0].error,
      "The stream was interrupted before it completed."
    );
  });

  it("does not let a stale save erase a durable terminal generation outcome", () => {
    const terminal = {
      id: "a1",
      role: "assistant" as const,
      content: "Partial answer",
      generationRunId: "run-1",
      streamSequence: 5,
      generationOutcome: "cancelled" as const,
      status: "complete" as const
    };
    const stale = {
      ...terminal,
      content: "Stale local answer",
      streamSequence: 99,
      generationOutcome: undefined
    };
    const current = {
      sessions: [session("active", 2, [terminal])],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [session("active", 3, [stale])],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);

    assert.equal(merged.sessions[0].messages[0].content, "Partial answer");
    assert.equal(
      merged.sessions[0].messages[0].generationOutcome,
      "cancelled"
    );
  });

  it("allows matching terminal metadata updates and a newer run takeover", () => {
    const terminal = {
      id: "a1",
      role: "assistant" as const,
      content: "Partial answer",
      generationRunId: "run-1",
      streamSequence: 5,
      generationOutcome: "cancelled" as const,
      status: "complete" as const
    };
    const matching = {
      ...terminal,
      content: "Updated cancelled presentation"
    };
    const current = {
      sessions: [session("active", 2, [terminal])],
      activeSessionId: "active"
    };
    const matchingSave = mergeClientSaveState(current, {
      sessions: [session("active", 3, [matching])],
      activeSessionId: "active"
    });
    const nextRun = mergeClientSaveState(current, {
      sessions: [
        session("active", 4, [
          {
            ...terminal,
            content: "",
            generationRunId: "run-2",
            streamSequence: 0,
            generationOutcome: undefined,
            status: "streaming" as const
          }
        ])
      ],
      activeSessionId: "active"
    });

    assert.equal(
      matchingSave.sessions[0].messages[0].content,
      "Updated cancelled presentation"
    );
    assert.equal(nextRun.sessions[0].messages[0].generationRunId, "run-2");
    assert.equal(nextRun.sessions[0].messages[0].generationOutcome, undefined);
    assert.equal(nextRun.sessions[0].messages[0].status, "streaming");
  });

  it("does not let a stale prior run replace a currently active run", () => {
    const active = {
      id: "a1",
      role: "assistant" as const,
      content: "New run partial",
      generationRunId: "run-2",
      streamSequence: 2,
      status: "streaming" as const
    };
    const stale = {
      ...active,
      content: "Old run terminal",
      generationRunId: "run-1",
      streamSequence: 99,
      generationOutcome: "complete" as const,
      status: "complete" as const
    };

    const merged = mergeClientSaveState(
      {
        sessions: [session("active", 5, [active])],
        activeSessionId: "active"
      },
      {
        sessions: [session("active", 6, [stale])],
        activeSessionId: "active"
      }
    );

    assert.equal(merged.sessions[0].messages[0].generationRunId, "run-2");
    assert.equal(merged.sessions[0].messages[0].status, "streaming");
    assert.equal(merged.sessions[0].messages[0].content, "New run partial");
  });

  it("preserves a cancelled branch tombstone and its hidden variant against stale saves", () => {
    const original = {
      id: "a-original",
      role: "assistant" as const,
      content: "Original",
      branchGroupId: "group-1",
      branchVariantId: "variant-1",
      branchAnchor: true
    };
    const cancelledUser = {
      id: "u-cancelled",
      role: "user" as const,
      content: "Retry",
      branchGroupId: "group-1",
      branchVariantId: "variant-2"
    };
    const tombstone = {
      id: "a-cancelled",
      role: "assistant" as const,
      content: "Generation stopped.",
      branchGroupId: "group-1",
      branchVariantId: "variant-2",
      branchAnchor: true,
      branchRunRollback: {
        runId: "run-2",
        groupId: "group-1",
        variantId: "variant-2",
        fallbackVariantId: "variant-1"
      },
      generationRunId: "run-2",
      generationOutcome: "cancelled" as const,
      status: "complete" as const
    };
    const current = {
      sessions: [
        {
          ...session("active", 5, [original, cancelledUser, tombstone]),
          branchSelections: { "group-1": "variant-2" }
        }
      ],
      activeSessionId: "active"
    };
    const staleIncoming = {
      sessions: [session("active", 6, [original])],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, staleIncoming);

    assert.deepEqual(
      merged.sessions[0].messages.map((message) => message.id),
      ["a-original", "a-cancelled"]
    );
    assert.equal(
      merged.sessions[0].messages[1].generationOutcome,
      "cancelled"
    );
    assert.deepEqual(
      merged.sessions[0].messages[1].branchRunRollback,
      tombstone.branchRunRollback
    );
    assert.equal(
      merged.sessions[0].branchSelections?.["group-1"],
      "variant-1"
    );
  });

  it("keeps completed artifact edits when an older client save arrives later", () => {
    const current = {
      sessions: [
        session("active", 50, [
          userMessage("u1", "make a card"),
          assistantWithCompletedArtifactEdit()
        ])
      ],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [
        session("active", 40, [
          userMessage("u1", "make a card"),
          {
            id: "a1",
            role: "assistant" as const,
            content: "",
            rawStream: "<chat></chat><streamui><p>Original</p></streamui>"
          }
        ])
      ],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);
    const assistant = merged.sessions[0].messages[1];
    const edit = assistant.artifactEdits?.[0] as
      | { status?: string }
      | undefined;

    assert.equal(assistant.rawStream, "<chat></chat><streamui><p>Edited</p></streamui>");
    assert.equal(assistant.activeArtifactEditId, "edit-1");
    assert.equal(edit?.status, "complete");
  });

  it("does not let older pending artifact edits replace completed edits", () => {
    const pendingAssistant = {
      ...assistantWithCompletedArtifactEdit(),
      rawStream: "<chat></chat><streamui><p>Original</p></streamui>",
      artifactEdits: [
        {
          id: "edit-1",
          createdAt: 20,
          prompt: "Change copy",
          references: [],
          activeVariantId: "variant-1",
          variants: [
            {
              id: "variant-1",
              createdAt: 20,
              status: "pending"
            }
          ],
          status: "pending"
        }
      ]
    };
    const current = {
      sessions: [
        session("active", 50, [
          userMessage("u1", "make a card"),
          assistantWithCompletedArtifactEdit()
        ])
      ],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [
        session("active", 40, [userMessage("u1", "make a card"), pendingAssistant])
      ],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);
    const assistant = merged.sessions[0].messages[1];
    const edit = assistant.artifactEdits?.[0] as
      | { status?: string; variants?: Array<{ status?: string }> }
      | undefined;

    assert.equal(assistant.rawStream, "<chat></chat><streamui><p>Edited</p></streamui>");
    assert.equal(edit?.status, "complete");
    assert.equal(edit?.variants?.[0]?.status, "complete");
  });

  it("preserves pending artifact operation ids through server client-save merge", () => {
    const current = {
      sessions: [session("active", 1, [userMessage("u1", "make a card")])],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [
        session("active", 2, [
          userMessage("u1", "make a card"),
          {
            id: "a1",
            role: "assistant" as const,
            content: "Artifact",
            rawStream: "<chat></chat><streamui><p>Original</p></streamui>",
            activeArtifactEditId: "edit-1",
            artifactEdits: [
              {
                id: "edit-1",
                createdAt: 2,
                prompt: "Still pending",
                references: [],
                activeVariantId: "variant-1",
                variants: [
                  {
                    id: "variant-1",
                    operationId: "artifact-edit-operation-1",
                    createdAt: 2,
                    status: "pending"
                  }
                ],
                status: "pending"
              }
            ]
          }
        ])
      ],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);
    const assistant = merged.sessions[0].messages[1];
    const variant = (
      assistant.artifactEdits?.[0] as
        | { variants?: Array<{ operationId?: string; status?: string }> }
        | undefined
    )?.variants?.[0];

    assert.equal(variant?.operationId, "artifact-edit-operation-1");
    assert.equal(variant?.status, "pending");
  });

  it("allows a newer save to discard artifact edit history", () => {
    const current = {
      sessions: [
        session("active", 40, [
          userMessage("u1", "make a card"),
          assistantWithCompletedArtifactEdit()
        ])
      ],
      activeSessionId: "active"
    };
    const incoming = {
      sessions: [
        session("active", 50, [
          userMessage("u1", "make a card"),
          {
            id: "a1",
            role: "assistant" as const,
            content: "",
            rawStream: "<chat></chat><streamui><p>Original</p></streamui>"
          }
        ])
      ],
      activeSessionId: "active"
    };

    const merged = mergeClientSaveState(current, incoming);
    const assistant = merged.sessions[0].messages[1];

    assert.equal(assistant.rawStream, "<chat></chat><streamui><p>Original</p></streamui>");
    assert.equal(assistant.artifactEdits, undefined);
    assert.equal(assistant.activeArtifactEditId, undefined);
  });
});
