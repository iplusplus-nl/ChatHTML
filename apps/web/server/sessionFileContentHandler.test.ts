import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { createSessionFileContentHandler } from "./sessions.js";
import type {
  StoredSessionFile,
  StoredSessionState
} from "./sessionStateTypes.js";

function stateWithFile(file: StoredSessionFile): StoredSessionState {
  return {
    activeSessionId: "session-1",
    sessions: [
      {
        id: "session-1",
        title: "Files",
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        files: [file]
      }
    ]
  };
}

function responseHarness() {
  const headers = new Map<string, string>();
  let contentType = "";
  let statusCode = 0;
  let sentBody: unknown;
  const response = {
    status(value: number) {
      statusCode = value;
      return response;
    },
    type(value: string) {
      contentType = value;
      return response;
    },
    set(values: Record<string, string>) {
      Object.entries(values).forEach(([name, value]) =>
        headers.set(name.toLowerCase(), value)
      );
      return response;
    },
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return response;
    },
    send(value: unknown) {
      sentBody = value;
      return response;
    }
  } as unknown as Response;
  return {
    response,
    headers,
    get contentType() {
      return contentType;
    },
    get sentBody() {
      return sentBody;
    },
    get statusCode() {
      return statusCode;
    }
  };
}

async function invoke(file: StoredSessionFile) {
  const handler = createSessionFileContentHandler({
    readStates: async () => [stateWithFile(file)],
    readFile: async () => ({
      buffer: Buffer.from("content"),
      mimeType: file.mimeType
    })
  });
  const harness = responseHarness();
  await handler(
    {
      params: { fileId: file.id },
      query: { token: file.accessToken }
    } as unknown as Request,
    harness.response
  );
  return harness;
}

function file(
  kind: StoredSessionFile["kind"],
  mimeType: string
): StoredSessionFile {
  return {
    id: `file-${kind}`,
    kind,
    name: "payload.html",
    mimeType,
    size: 7,
    createdAt: 1,
    accessToken: "secret-token"
  };
}

describe("session file content handler", () => {
  it("serves active and forged image types as inert downloads", async () => {
    for (const candidate of [
      file("artifact", "text/html"),
      file("image", "image/svg+xml")
    ]) {
      const result = await invoke(candidate);

      assert.equal(result.statusCode, 200);
      assert.equal(result.contentType, "application/octet-stream");
      assert.match(
        result.headers.get("content-disposition") ?? "",
        /^attachment;/
      );
      assert.equal(
        result.headers.get("content-security-policy"),
        "default-src 'none'; sandbox"
      );
      assert.equal(
        result.headers.get("cross-origin-resource-policy"),
        "same-origin"
      );
      assert.equal(result.headers.has("access-control-allow-origin"), false);
      assert.deepEqual(result.sentBody, Buffer.from("content"));
    }
  });

  it("keeps a verified raster image inline for the opaque preview", async () => {
    const result = await invoke(file("image", "image/png"));

    assert.equal(result.statusCode, 200);
    assert.equal(result.contentType, "image/png");
    assert.match(result.headers.get("content-disposition") ?? "", /^inline;/);
    assert.equal(
      result.headers.get("cross-origin-resource-policy"),
      "cross-origin"
    );
    assert.equal(result.headers.get("access-control-allow-origin"), "*");
  });
});
