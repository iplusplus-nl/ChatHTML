import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { ResponsesTerminalFailureError } from "./responsesEventReducer.js";
import {
  RESPONSES_MAX_ERROR_BODY_BYTES,
  RESPONSES_MAX_SSE_LINE_CHARS,
  formatResponsesHttpError,
  streamResponsesOnce,
  summarizeHttpErrorBody,
  type ResponsesStreamApiSettings,
  type ResponsesStreamState
} from "./responsesStreamClient.js";

const apiSettings: ResponsesStreamApiSettings = {
  providerName: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKeySource: "manual",
  apiKeyEnvironmentName: "OPENROUTER_API_KEY",
  apiKey: "sk-or-test",
  model: "test/model",
  reasoningEffort: "high"
};

function createState(): ResponsesStreamState {
  return {
    contentChars: 0,
    contentEvents: 0,
    reasoningChars: 0,
    reasoningEvents: 0
  };
}

function encodeChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
}

function responseFetch(chunks: string[]): typeof fetch {
  return async () =>
    new Response(encodeChunks(chunks), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    });
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function collectStream(
  chunks: string[],
  overrides: Partial<Parameters<typeof streamResponsesOnce>[0]> = {}
) {
  const events: Array<{ type: "content" | "reasoning"; text: string }> = [];
  const state = createState();
  const calls = await streamResponsesOnce({
    endpoint: "https://example.test/responses",
    apiSettings,
    input: [],
    instructions: "test",
    tools: [],
    emit: (event) => events.push(event),
    state,
    signal: new AbortController().signal,
    useOpenRouterReasoning: true,
    fetchImpl: responseFetch(chunks),
    ...overrides
  });
  return { events, state, calls };
}

describe("Responses stream client", () => {
  it("parses SSE JSON split across chunks and flushes a final line without newline", async () => {
    const first = JSON.stringify({
      type: "response.output_text.delta",
      item_id: "message-1",
      delta: "跨块"
    });
    const second = JSON.stringify({
      type: "response.output_text.delta",
      item_id: "message-1",
      delta: " tail"
    });
    const completed = JSON.stringify({
      type: "response.completed",
      response: { status: "completed" }
    });
    const split = Math.floor(first.length / 2);
    const { events, state } = await collectStream([
      `data: ${first.slice(0, split)}`,
      `${first.slice(split)}\n\n`,
      `data: ${second}\n`,
      `data: ${completed}`
    ]);

    assert.deepEqual(events, [
      { type: "content", text: "跨块" },
      { type: "content", text: " tail" }
    ]);
    assert.deepEqual(state, {
      contentChars: 7,
      contentEvents: 2,
      reasoningChars: 0,
      reasoningEvents: 0
    });
  });

  it("deduplicates content and reasoning done events after deltas", async () => {
    const events = [
      {
        type: "response.output_text.delta",
        item_id: "message-1",
        delta: "Answer"
      },
      {
        type: "response.output_text.done",
        item_id: "message-1",
        text: "Answer"
      },
      {
        type: "response.reasoning_text.delta",
        item_id: "reason-1",
        delta: "Reason"
      },
      {
        type: "response.reasoning_text.done",
        item_id: "reason-1",
        text: "Reason"
      }
    ];
    const stream = `${events
      .map((event) => `data: ${JSON.stringify(event)}\n`)
      .join("")}data: [DONE]\n`;
    const result = await collectStream([stream]);

    assert.deepEqual(result.events, [
      { type: "content", text: "Answer" },
      { type: "reasoning", text: "Reason" }
    ]);
    assert.equal(result.state.contentEvents, 1);
    assert.equal(result.state.reasoningEvents, 1);
  });

  it("returns completed function calls assembled from added and argument events", async () => {
    const stream = [
      {
        type: "response.output_item.added",
        output_index: 1,
        item: {
          type: "function_call",
          id: "item-1",
          call_id: "call-1",
          name: "retrieve",
          arguments: ""
        }
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "item-1",
        delta: "{\"url\":"
      },
      {
        type: "response.function_call_arguments.done",
        output_index: 1,
        item_id: "item-1",
        arguments: "{\"url\":\"https://example.com\"}"
      },
      {
        type: "response.output_item.done",
        output_index: 1,
        item: {
          type: "function_call",
          id: "item-1",
          call_id: "call-1",
          name: "retrieve",
          arguments: "{\"url\":\"https://example.com\"}"
        }
      }
    ].map((event) => `data: ${JSON.stringify(event)}\n`);
    stream.push("data: [DONE]\n");
    const { calls } = await collectStream(stream);

    assert.deepEqual(calls, [
      {
        type: "function_call",
        id: "item-1",
        call_id: "call-1",
        name: "retrieve",
        arguments: "{\"url\":\"https://example.com\"}"
      }
    ]);
  });

  it("fills content from the final response when no text delta arrived", async () => {
    const finalEvent = {
      type: "response.done",
      response: {
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "Final text" }]
          }
        ]
      }
    };
    const { events } = await collectStream([
      `data: ${JSON.stringify(finalEvent)}\n`
    ]);

    assert.deepEqual(events, [{ type: "content", text: "Final text" }]);
  });

  it("streams refusal events as content without duplicating done or final text", async () => {
    const events = [
      {
        type: "response.refusal.delta",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        delta: "I cannot help."
      },
      {
        type: "response.refusal.done",
        item_id: "message-1",
        output_index: 0,
        content_index: 0,
        refusal: "I cannot help."
      },
      {
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                { type: "refusal", refusal: "I cannot help." }
              ]
            }
          ]
        }
      }
    ];
    const stream = events
      .map((event) => `data: ${JSON.stringify(event)}\n`)
      .join("");
    const result = await collectStream([stream]);

    assert.deepEqual(result.events, [
      { type: "content", text: "I cannot help." }
    ]);
    assert.equal(result.state.contentChars, 14);
    assert.equal(result.state.contentEvents, 1);
  });

  it("rejects a stream that reaches EOF after a partial delta without a terminal signal", async () => {
    const delta = {
      type: "response.output_text.delta",
      item_id: "message-1",
      delta: "Partial"
    };

    await assert.rejects(
      collectStream([`data: ${JSON.stringify(delta)}\n`]),
      (error: unknown) => {
        assert.ok(error instanceof ResponsesTerminalFailureError);
        assert.equal(error.status, "incomplete");
        assert.equal(error.incompleteReason, "stream_eof");
        assert.equal(
          error.message,
          "Responses API stream ended before a terminal event."
        );
        return true;
      }
    );
  });

  it("rejects an official error event after partial content even when DONE follows", async () => {
    const emitted: Array<{ type: "content" | "reasoning"; text: string }> = [];
    const stream = [
      {
        type: "response.output_text.delta",
        item_id: "message-1",
        delta: "Partial answer"
      },
      {
        type: "error",
        code: "server_error",
        message: "Provider stream failed",
        param: null
      }
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n`)
      .join("");

    await assert.rejects(
      collectStream([`${stream}data: [DONE]\n`], {
        emit: (event) => emitted.push(event)
      }),
      (error: unknown) => {
        assert.ok(error instanceof ResponsesTerminalFailureError);
        assert.equal(error.status, "error");
        assert.equal(error.message, "Provider stream failed");
        return true;
      }
    );
    assert.deepEqual(emitted, [
      { type: "content", text: "Partial answer" }
    ]);
  });

  for (const [event, status, message] of [
    [
      { type: "response.failed", error: { message: "failed response" } },
      "failed",
      "failed response"
    ],
    [
      {
        type: "response.incomplete",
        response: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" }
        }
      },
      "incomplete",
      "Responses API returned incomplete."
    ],
    [{ type: "response.cancelled" }, "cancelled", "Responses API returned cancelled."]
  ] as const) {
    it(`throws a typed ${status} terminal failure`, async () => {
      await assert.rejects(
        collectStream([`data: ${JSON.stringify(event)}`]),
        (error: unknown) => {
          assert.ok(error instanceof ResponsesTerminalFailureError);
          assert.equal(error.status, status);
          assert.equal(error.message, message);
          if (status === "incomplete") {
            assert.equal(error.incompleteReason, "max_output_tokens");
          }
          return true;
        }
      );
    });
  }

  it("cancels a pending response reader when the signal aborts", async () => {
    let readerCancelled = false;
    let readerStarted!: () => void;
    const readerStartedPromise = new Promise<void>((resolve) => {
      readerStarted = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        readerStarted();
      },
      cancel() {
        readerCancelled = true;
      }
    });
    const controller = new AbortController();
    const request = streamResponsesOnce({
      endpoint: "https://example.test/responses",
      apiSettings,
      input: [],
      instructions: "test",
      tools: [],
      emit: () => undefined,
      state: createState(),
      signal: controller.signal,
      useOpenRouterReasoning: false,
      fetchImpl: async () => new Response(stream, { status: 200 })
    });

    await readerStartedPromise;
    controller.abort();

    await assert.rejects(request, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "AbortError");
      return true;
    });
    assert.equal(readerCancelled, true);
  });

  it("sends the expected Responses request body through an injected fetch", async () => {
    let requestInit: RequestInit | undefined;
    await collectStream(["data: [DONE]\n"], {
      tools: [
        {
          type: "function",
          name: "retrieve",
          description: "Retrieve",
          strict: null,
          parameters: { type: "object", properties: {} }
        }
      ],
      maxOutputTokens: 321,
      fetchImpl: async (_input, init) => {
        requestInit = init;
        return new Response("data: [DONE]\n", { status: 200 });
      }
    });

    assert.equal(requestInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      model: "test/model",
      input: [],
      instructions: "test",
      stream: true,
      max_output_tokens: 321,
      tools: [
        {
          type: "function",
          name: "retrieve",
          description: "Retrieve",
          strict: null,
          parameters: { type: "object", properties: {} }
        }
      ],
      tool_choice: "auto",
      reasoning: { effort: "high" }
    });
    assert.equal(requestInit?.redirect, "error");
  });

  it("does not invoke fetch when an environment key targets an attacker origin", async () => {
    let fetchCalls = 0;
    await assert.rejects(
      streamResponsesOnce({
        endpoint: "https://attacker.invalid/collect",
        apiSettings: {
          ...apiSettings,
          apiKeySource: "environment",
          apiKeyEnvironmentName: "OPENROUTER_API_KEY",
          apiKey: "server-secret-must-not-leak"
        },
        input: [],
        instructions: "test",
        tools: [],
        emit: () => undefined,
        state: createState(),
        signal: new AbortController().signal,
        useOpenRouterReasoning: false,
        fetchImpl: async () => {
          fetchCalls += 1;
          return new Response("data: [DONE]\n");
        }
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /only be sent to https:\/\/openrouter\.ai/);
        assert.doesNotMatch(error.message, /server-secret-must-not-leak/);
        return true;
      }
    );
    assert.equal(fetchCalls, 0);
  });

  it("sends an environment key to the canonical Responses endpoint", async () => {
    let authorization = "";
    await streamResponsesOnce({
      endpoint: "https://openrouter.ai/api/v1/responses",
      apiSettings: {
        ...apiSettings,
        apiKeySource: "environment",
        apiKeyEnvironmentName: "OPENROUTER_API_KEY",
        apiKey: "canonical-server-key"
      },
      input: [],
      instructions: "test",
      tools: [],
      emit: () => undefined,
      state: createState(),
      signal: new AbortController().signal,
      useOpenRouterReasoning: false,
      fetchImpl: async (_input, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response("data: [DONE]\n", { status: 200 });
      }
    });

    assert.equal(authorization, "Bearer canonical-server-key");
  });

  it("binds an operator environment key to the exact configured Responses sink", async () => {
    const previousBaseUrl = process.env.OPENROUTER_BASE_URL;
    process.env.OPENROUTER_BASE_URL = "https://operator-proxy.example/v1";
    const settings = {
      ...apiSettings,
      baseUrl: "https://operator-proxy.example/v1",
      apiKeySource: "environment" as const,
      apiKeyEnvironmentName: "OPENROUTER_API_KEY",
      apiKey: "operator-responses-key"
    };
    let acceptedAuthorization = "";
    let rejectedFetchCalls = 0;

    try {
      await streamResponsesOnce({
        endpoint: "https://operator-proxy.example/v1/responses",
        apiSettings: settings,
        input: [],
        instructions: "test",
        tools: [],
        emit: () => undefined,
        state: createState(),
        signal: new AbortController().signal,
        useOpenRouterReasoning: false,
        fetchImpl: async (_input, init) => {
          acceptedAuthorization =
            new Headers(init?.headers).get("authorization") ?? "";
          return new Response("data: [DONE]\n", { status: 200 });
        }
      });

      await assert.rejects(
        streamResponsesOnce({
          endpoint: "https://openrouter.ai/api/v1/responses",
          apiSettings: settings,
          input: [],
          instructions: "test",
          tools: [],
          emit: () => undefined,
          state: createState(),
          signal: new AbortController().signal,
          useOpenRouterReasoning: false,
          fetchImpl: async () => {
            rejectedFetchCalls += 1;
            return new Response("data: [DONE]\n", { status: 200 });
          }
        }),
        /only be sent to https:\/\/operator-proxy\.example\/v1\/responses/
      );
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.OPENROUTER_BASE_URL;
      } else {
        process.env.OPENROUTER_BASE_URL = previousBaseUrl;
      }
    }

    assert.equal(acceptedAuthorization, "Bearer operator-responses-key");
    assert.equal(rejectedFetchCalls, 0);
  });

  it("does not forward Authorization across an HTTP redirect", async () => {
    let sinkRequests = 0;
    let sinkAuthorization = "";
    const sink = createServer((req, res) => {
      sinkRequests += 1;
      sinkAuthorization = req.headers.authorization ?? "";
      req.resume();
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("data: [DONE]\n");
    });
    const sinkPort = await listenOnLoopback(sink);
    let sourceAuthorization = "";
    const source = createServer((req, res) => {
      sourceAuthorization = req.headers.authorization ?? "";
      req.resume();
      res.writeHead(307, {
        Location: `http://127.0.0.1:${sinkPort}/responses`
      });
      res.end();
    });
    const sourcePort = await listenOnLoopback(source);

    try {
      await assert.rejects(
        streamResponsesOnce({
          endpoint: `http://127.0.0.1:${sourcePort}/responses`,
          apiSettings: {
            ...apiSettings,
            providerName: "Local",
            baseUrl: `http://127.0.0.1:${sourcePort}`,
            apiKey: "manual-redirect-key"
          },
          input: [],
          instructions: "test",
          tools: [],
          emit: () => undefined,
          state: createState(),
          signal: new AbortController().signal,
          useOpenRouterReasoning: false
        })
      );
    } finally {
      await Promise.all([closeServer(source), closeServer(sink)]);
    }

    assert.equal(sourceAuthorization, "Bearer manual-redirect-key");
    assert.equal(sinkRequests, 0);
    assert.equal(sinkAuthorization, "");
  });
});

describe("Responses HTTP error formatting", () => {
  it("extracts and compacts a nested JSON error without exposing JSON markup", () => {
    const body = JSON.stringify({
      error: { error: { message: "  Invalid   request  " } }
    });

    assert.equal(summarizeHttpErrorBody(body), "Invalid request");
    assert.equal(
      formatResponsesHttpError({ status: 400, statusText: "Bad Request" }, body),
      "Responses API request failed with HTTP 400 Bad Request. Invalid request"
    );
  });

  it("sanitizes HTML proxy pages and excludes script and style contents", () => {
    const body = `<!doctype html><html><head><title>Gateway unavailable</title><style>.secret{}</style></head><body><script>steal()</script><h1>Internal proxy detail</h1></body></html>`;

    assert.equal(summarizeHttpErrorBody(body), "Gateway unavailable");
    assert.equal(
      formatResponsesHttpError({ status: 502, statusText: "Bad Gateway" }, body),
      "Responses API request failed with HTTP 502 Bad Gateway. Gateway unavailable"
    );
  });

  it("formats a sanitized non-2xx body returned by the injected fetch", async () => {
    await assert.rejects(
      streamResponsesOnce({
        endpoint: "https://example.test/responses",
        apiSettings,
        input: [],
        instructions: "test",
        tools: [],
        emit: () => undefined,
        state: createState(),
        signal: new AbortController().signal,
        useOpenRouterReasoning: false,
        fetchImpl: async () =>
          new Response("<html><title>Denied</title><script>secret</script></html>", {
            status: 403,
            statusText: "Forbidden"
          })
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /HTTP 403 Forbidden/);
        assert.match(error.message, /Denied/);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      }
    );
  });

  it("cancels a non-2xx response body once the diagnostic byte cap is reached", async () => {
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array(RESPONSES_MAX_ERROR_BODY_BYTES + 1).fill(97)
        );
      },
      cancel() {
        cancelled = true;
      }
    });

    await assert.rejects(
      streamResponsesOnce({
        endpoint: "https://example.test/responses",
        apiSettings,
        input: [],
        instructions: "test",
        tools: [],
        emit: () => undefined,
        state: createState(),
        signal: new AbortController().signal,
        useOpenRouterReasoning: false,
        fetchImpl: async () => new Response(oversized, { status: 502 })
      }),
      /HTTP 502/
    );
    assert.equal(cancelled, true);
  });

  it("rejects an unbounded SSE line and cancels the provider body", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${"x".repeat(RESPONSES_MAX_SSE_LINE_CHARS)}`)
        );
      },
      cancel() {
        cancelled = true;
      }
    });

    await assert.rejects(
      streamResponsesOnce({
        endpoint: "https://example.test/responses",
        apiSettings,
        input: [],
        instructions: "test",
        tools: [],
        emit: () => undefined,
        state: createState(),
        signal: new AbortController().signal,
        useOpenRouterReasoning: false,
        fetchImpl: async () => new Response(oversized, { status: 200 })
      }),
      /line longer than/
    );
    assert.equal(cancelled, true);
  });

  it("rejects an oversized complete SSE line before parsing it", async () => {
    const encoder = new TextEncoder();
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${"x".repeat(RESPONSES_MAX_SSE_LINE_CHARS)}\n`
          )
        );
        controller.close();
      }
    });

    await assert.rejects(
      streamResponsesOnce({
        endpoint: "https://example.test/responses",
        apiSettings,
        input: [],
        instructions: "test",
        tools: [],
        emit: () => undefined,
        state: createState(),
        signal: new AbortController().signal,
        useOpenRouterReasoning: false,
        fetchImpl: async () => new Response(oversized, { status: 200 })
      }),
      /line longer than/
    );
  });
});
