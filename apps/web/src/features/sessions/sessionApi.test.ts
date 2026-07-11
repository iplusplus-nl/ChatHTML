import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionPageExitTransport,
  deleteSessionFile,
  requestSessionIndex,
  requestSessions,
  saveSerializedSessionState,
  saveSessionStateOnPageExit,
  sessionRequestHeaders,
  uploadSessionFile
} from "./sessionApi";

type FetchCall = { input: RequestInfo | URL; init?: RequestInit };

function mockFetch(response: Response) {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return response;
  };
  return { calls, fetchImpl };
}

describe("session API", () => {
  it("adds the client id and optional content type headers", () => {
    assert.deepEqual(sessionRequestHeaders("client-1"), {
      "X-ChatHTML-Client-Id": "client-1"
    });
    assert.deepEqual(sessionRequestHeaders("client-1", "application/json"), {
      "Content-Type": "application/json",
      "X-ChatHTML-Client-Id": "client-1"
    });
  });

  it("requests the session index and full session state", async () => {
    const { calls, fetchImpl } = mockFetch(Response.json({}));

    await requestSessionIndex("client-1", fetchImpl);
    await requestSessions("client-1", fetchImpl);

    assert.deepEqual(
      calls.map((call) => call.input),
      ["/api/sessions/index", "/api/sessions"]
    );
    assert.deepEqual(calls[0].init?.headers, {
      "X-ChatHTML-Client-Id": "client-1"
    });
  });

  it("uploads files with encoded session ids and parses the returned file", async () => {
    const file = {
      id: "file-1",
      kind: "artifact" as const,
      name: "demo.html",
      mimeType: "text/html",
      size: 12,
      createdAt: 1
    };
    const { calls, fetchImpl } = mockFetch(Response.json({ file }, { status: 201 }));

    assert.deepEqual(
      await uploadSessionFile(
        "session/one",
        { kind: "artifact", name: "demo.html", mimeType: "text/html", text: "hi" },
        "client-1",
        fetchImpl
      ),
      file
    );
    assert.equal(calls[0].input, "/api/sessions/session%2Fone/files");
    assert.equal(calls[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      kind: "artifact",
      name: "demo.html",
      mimeType: "text/html",
      text: "hi",
      clientId: "client-1"
    });
  });

  it("surfaces file upload errors from the API", async () => {
    const { fetchImpl } = mockFetch(
      Response.json({ error: "File is too large." }, { status: 413 })
    );

    await assert.rejects(
      uploadSessionFile(
        "session-1",
        { kind: "artifact", name: "demo.html", mimeType: "text/html" },
        "client-1",
        fetchImpl
      ),
      /File is too large/
    );
  });

  it("deletes encoded file ids and rejects failed deletes", async () => {
    const success = mockFetch(new Response(null, { status: 204 }));
    await deleteSessionFile("session/one", "file/two", "client-1", success.fetchImpl);
    assert.equal(
      success.calls[0].input,
      "/api/sessions/session%2Fone/files/file%2Ftwo"
    );
    assert.equal(success.calls[0].init?.method, "DELETE");

    const failure = mockFetch(new Response(null, { status: 500 }));
    await assert.rejects(
      deleteSessionFile("session-1", "file-1", "client-1", failure.fetchImpl),
      /File delete failed with HTTP 500/
    );
  });

  it("saves state with PUT and flushes through beacon when available", async () => {
    const saved = mockFetch(new Response(null, { status: 204 }));
    const revisionedState = "{\"sessions\":[],\"saveRevision\":42}";
    await saveSerializedSessionState(
      revisionedState,
      "client-1",
      undefined,
      saved.fetchImpl
    );
    assert.equal(saved.calls[0].init?.method, "PUT");
    assert.equal(saved.calls[0].init?.body, revisionedState);

    const beaconCalls: Array<{ url: string; data: BodyInit }> = [];
    saveSessionStateOnPageExit(revisionedState, "client-1", {
      fetch: async () => {
        throw new Error("fetch should not run when beacon succeeds");
      },
      sendBeacon: (url, data) => {
        beaconCalls.push({ url, data });
        return true;
      }
    });

    assert.equal(beaconCalls.length, 1);
    assert.equal(beaconCalls[0].url, "/api/sessions");
    assert.ok(beaconCalls[0].data instanceof Blob);
    assert.equal(await (beaconCalls[0].data as Blob).text(), revisionedState);
  });

  it("falls back to a keepalive PUT when the exit beacon declines", () => {
    const fallback = mockFetch(new Response(null, { status: 204 }));

    saveSessionStateOnPageExit("{\"sessions\":[]}", "client-1", {
      fetch: fallback.fetchImpl,
      sendBeacon: () => false
    });

    assert.equal(fallback.calls.length, 1);
    assert.equal(fallback.calls[0].input, "/api/sessions");
    assert.equal(fallback.calls[0].init?.method, "PUT");
    assert.equal(fallback.calls[0].init?.keepalive, true);
    assert.equal(fallback.calls[0].init?.body, "{\"sessions\":[]}");
  });

  it("binds page-exit browser methods to their native owners", async () => {
    let fetchOwner: unknown;
    let beaconOwner: unknown;
    const navigatorOwner = {
      sendBeacon(this: unknown) {
        beaconOwner = this;
        return false;
      }
    };
    const environment = {
      fetch(this: unknown) {
        fetchOwner = this;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      navigator: navigatorOwner
    };
    const transport = createSessionPageExitTransport(environment);

    await transport.fetch("/api/sessions");
    transport.sendBeacon?.("/api/sessions", new Blob());

    assert.equal(fetchOwner, environment);
    assert.equal(beaconOwner, navigatorOwner);
  });
});
