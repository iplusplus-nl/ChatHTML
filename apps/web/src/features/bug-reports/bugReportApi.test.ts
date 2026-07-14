import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { submitBugReport, type BugReportEnvironment } from "./bugReportApi";

const environment: BugReportEnvironment = {
  pageUrl: "http://127.0.0.1:5173/chat",
  userAgent: "ChatHTML test",
  viewport: {
    width: 1280,
    height: 720,
    devicePixelRatio: 2
  }
};

describe("bug report API", () => {
  it("submits the report with browser diagnostics and client headers", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const abortController = new AbortController();
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return Response.json({ id: "report-1" }, { status: 201 });
    };

    const id = await submitBugReport(
      {
        sessionId: "session-1",
        sessionTitle: "Demo",
        draft: {
          text: "The preview is clipped.",
          images: [],
          updatedAt: 1
        }
      },
      "client-1",
      abortController.signal,
      environment,
      fetchImpl
    );

    assert.equal(id, "report-1");
    assert.equal(calls[0].input, "/api/bug-reports");
    assert.deepEqual(calls[0].init?.headers, {
      "Content-Type": "application/json",
      "X-ChatHTML-Client-Id": "client-1"
    });
    assert.equal(calls[0].init?.signal, abortController.signal);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
      clientId: "client-1",
      sessionId: "session-1",
      sessionTitle: "Demo",
      text: "The preview is clipped.",
      images: [],
      ...environment
    });
  });

  it("surfaces server errors and falls back to the HTTP status", async () => {
    const apiError: typeof fetch = async () =>
      Response.json({ error: "GitHub is unavailable." }, { status: 502 });
    await assert.rejects(
      submitBugReport(
        {
          sessionId: "session-1",
          sessionTitle: "Demo",
          draft: { text: "Broken", images: [], updatedAt: 1 }
        },
        "client-1",
        undefined,
        environment,
        apiError
      ),
      /GitHub is unavailable/
    );

    const invalidResponse: typeof fetch = async () =>
      new Response("not json", { status: 500 });
    await assert.rejects(
      submitBugReport(
        {
          sessionId: "session-1",
          sessionTitle: "Demo",
          draft: { text: "Broken", images: [], updatedAt: 1 }
        },
        "client-1",
        undefined,
        environment,
        invalidResponse
      ),
      /Bug report failed with HTTP 500/
    );
  });
});
