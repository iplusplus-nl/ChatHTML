import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { createModelsHandler } from "./models.js";

function request(apiSettings: Record<string, unknown>): Request {
  return { body: { apiSettings } } as Request;
}

function responseHarness() {
  const statuses: number[] = [];
  const bodies: unknown[] = [];
  const response = {
    status(code: number) {
      statuses.push(code);
      return response;
    },
    json(body: unknown) {
      bodies.push(body);
      return response;
    }
  } as unknown as Response;
  return { response, statuses, bodies };
}

function openRouterEnvironmentSettings(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeySource: "environment",
    ...overrides
  };
}

function manualSettings(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    providerId: "custom",
    providerName: "Custom",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKeySource: "manual",
    apiKey: "manual-key",
    ...overrides
  };
}

describe("models endpoint credential safety", () => {
  it("never calls an attacker models endpoint with an environment credential", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "server-secret-must-not-leak";
    let fetchCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response('{"data":[]}');
    };
    const handler = createModelsHandler({ fetchImpl });
    const response = responseHarness();

    try {
      await handler(
        request(
          openRouterEnvironmentSettings({
            modelsEndpoint: "https://attacker.invalid/collect"
          })
        ),
        response.response
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousKey;
      }
    }

    assert.equal(fetchCalls, 0);
    assert.deepEqual(response.statuses, [400]);
    const error = String((response.bodies[0] as { error?: unknown }).error);
    assert.match(error, /only be sent to https:\/\/openrouter\.ai/);
    assert.doesNotMatch(error, /server-secret-must-not-leak/);
  });

  it("sends the environment credential to the canonical models endpoint", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "canonical-server-key";
    let receivedUrl = "";
    let receivedAuthorization = "";
    let receivedRedirect: RequestInit["redirect"] | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      receivedUrl = String(input);
      receivedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      receivedRedirect = init?.redirect;
      return new Response(
        JSON.stringify({ data: [{ id: "model/a" }, { id: "model/b" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };
    const handler = createModelsHandler({ fetchImpl });
    const response = responseHarness();

    try {
      await handler(
        request(openRouterEnvironmentSettings()),
        response.response
      );
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousKey;
      }
    }

    assert.equal(receivedUrl, "https://openrouter.ai/api/v1/models");
    assert.equal(receivedAuthorization, "Bearer canonical-server-key");
    assert.equal(receivedRedirect, "error");
    assert.deepEqual(response.statuses, []);
    assert.deepEqual(response.bodies, [{ models: ["model/a", "model/b"] }]);
  });

  it("preserves manual keys for custom and local model endpoints", async () => {
    let receivedAuthorization = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      receivedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response('{"models":[{"name":"local/model"}]}');
    };
    const handler = createModelsHandler({ fetchImpl });
    const response = responseHarness();

    await handler(request(manualSettings()), response.response);

    assert.equal(receivedAuthorization, "Bearer manual-key");
    assert.deepEqual(response.bodies, [{ models: ["local/model"] }]);
  });

  it("binds an operator environment key to the exact configured models sink", async () => {
    const previousBaseUrl = process.env.OPENROUTER_BASE_URL;
    const previousModelsEndpoint = process.env.OPENROUTER_MODELS_ENDPOINT;
    const previousKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_BASE_URL = "https://operator-proxy.example/v1";
    process.env.OPENROUTER_MODELS_ENDPOINT =
      "https://models-proxy.example/catalog?tenant=one";
    process.env.OPENROUTER_API_KEY = "operator-models-key";
    const requests: Array<{ authorization: string; url: string }> = [];
    const handler = createModelsHandler({
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          authorization:
            new Headers(init?.headers).get("authorization") ?? ""
        });
        return new Response('{"data":[]}');
      }
    });

    try {
      const accepted = responseHarness();
      await handler(
        request(
          openRouterEnvironmentSettings({
            baseUrl: "https://operator-proxy.example/v1",
            modelsEndpoint:
              "https://models-proxy.example/catalog?tenant=one"
          })
        ),
        accepted.response
      );
      assert.deepEqual(accepted.statuses, []);

      const rejected = responseHarness();
      await handler(
        request(openRouterEnvironmentSettings()),
        rejected.response
      );
      assert.deepEqual(rejected.statuses, [400]);
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.OPENROUTER_BASE_URL;
      } else {
        process.env.OPENROUTER_BASE_URL = previousBaseUrl;
      }
      if (previousModelsEndpoint === undefined) {
        delete process.env.OPENROUTER_MODELS_ENDPOINT;
      } else {
        process.env.OPENROUTER_MODELS_ENDPOINT = previousModelsEndpoint;
      }
      if (previousKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousKey;
      }
    }

    assert.deepEqual(requests, [
      {
        url: "https://models-proxy.example/catalog?tenant=one",
        authorization: "Bearer operator-models-key"
      }
    ]);
  });

  it("aborts a models request at the configured timeout", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true }
        );
      });
    const handler = createModelsHandler({ fetchImpl, timeoutMs: 5 });
    const response = responseHarness();

    await handler(request(manualSettings()), response.response);

    assert.deepEqual(response.statuses, [504]);
    assert.match(
      String((response.bodies[0] as { error?: unknown }).error),
      /timed out after 5ms/
    );
  });

  it("stops reading a models response above the byte limit", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"models":["this response is intentionally too large"]}');
    const handler = createModelsHandler({
      fetchImpl,
      responseMaxBytes: 16
    });
    const response = responseHarness();

    await handler(request(manualSettings()), response.response);

    assert.deepEqual(response.statuses, [502]);
    assert.match(
      String((response.bodies[0] as { error?: unknown }).error),
      /16 byte limit/
    );
  });
});
