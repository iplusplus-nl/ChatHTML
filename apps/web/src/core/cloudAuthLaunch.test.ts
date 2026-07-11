import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  startCloudAuthentication,
  type ChatHtmlNativeAuthBridge
} from "./cloudAuthLaunch";

describe("cloud authentication launch", () => {
  it("uses the browser redirect when no native bridge exists", async () => {
    let assigned = "";
    let fetches = 0;
    const result = await startCloudAuthentication({
      nativeBridge: null,
      assignLocation: (url) => {
        assigned = url;
      },
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("The web launch must not call fetch.");
      }
    });

    assert.equal(result, null);
    assert.equal(assigned, "/api/auth/start");
    assert.equal(fetches, 0);
  });

  it("round-trips an app callback through the native bridge", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const bridge: ChatHtmlNativeAuthBridge = {
      async authorize(request) {
        assert.equal(request.callbackScheme, "chathtml");
        assert.match(request.authorizationUrl, /^https:\/\/service\.example/);
        return {
          callbackUrl:
            "chathtml://oauth/callback?code=one-time-code&state=oauth-state"
        };
      }
    };
    const result = await startCloudAuthentication({
      nativeBridge: bridge,
      fetchImpl: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === "/api/auth/native/start") {
          const authorizationUrl = new URL(
            "https://service.example/oauth/authorize"
          );
          authorizationUrl.searchParams.set("response_type", "code");
          authorizationUrl.searchParams.set("client_id", "chathtml");
          authorizationUrl.searchParams.set(
            "redirect_uri",
            "chathtml://oauth/callback"
          );
          authorizationUrl.searchParams.set("state", "s".repeat(32));
          authorizationUrl.searchParams.set(
            "code_challenge",
            "c".repeat(43)
          );
          authorizationUrl.searchParams.set(
            "code_challenge_method",
            "S256"
          );
          return Response.json({
            authorizationUrl: authorizationUrl.toString(),
            callbackScheme: "chathtml"
          });
        }
        assert.equal(url, "/api/auth/native/callback");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          callbackUrl:
            "chathtml://oauth/callback?code=one-time-code&state=oauth-state"
        });
        return Response.json({
          user: { id: "user-1", email: "app@example.com", role: "user" },
          auth: { available: true, requiresInvite: false, firstUser: false }
        });
      }
    });

    assert.equal(result?.user?.email, "app@example.com");
    assert.deepEqual(
      calls.map((call) => call.url),
      ["/api/auth/native/start", "/api/auth/native/callback"]
    );
    assert.equal(calls[0]?.init?.credentials, "same-origin");
    assert.equal(calls[1]?.init?.credentials, "same-origin");
  });

  it("rejects an unsafe authorization URL before opening the app browser", async () => {
    let bridgeCalls = 0;
    await assert.rejects(
      () =>
        startCloudAuthentication({
          nativeBridge: {
            async authorize() {
              bridgeCalls += 1;
              return { callbackUrl: "chathtml://oauth/callback" };
            }
          },
          fetchImpl: async () =>
            Response.json({
              authorizationUrl: "javascript:alert(1)",
              callbackScheme: "chathtml"
            })
        }),
      /unsafe app authorization URL/
    );
    assert.equal(bridgeCalls, 0);
  });

  it("rejects a non-loopback HTTP authorization URL", async () => {
    await assert.rejects(
      () =>
        startCloudAuthentication({
          nativeBridge: {
            async authorize() {
              throw new Error("The unsafe URL must not be opened.");
            }
          },
          fetchImpl: async () =>
            Response.json({
              authorizationUrl: "http://service.example/oauth/authorize",
              callbackScheme: "chathtml"
            })
        }),
      /unsafe app authorization URL/
    );
  });
});
