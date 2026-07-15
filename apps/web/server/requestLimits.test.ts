import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import express from "express";
import type { Request } from "express";
import { createConcurrencyLimit, requestIp } from "./requestLimits.js";

describe("request IP", () => {
  it("trusts only the client IP supplied by the local Nginx hop", () => {
    const localRequest = {
      socket: { remoteAddress: "127.0.0.1" },
      ip: "127.0.0.1",
      get: (name: string) =>
        name.toLowerCase() === "x-real-ip" ? "203.0.113.9" : undefined
    } as unknown as Request;
    assert.equal(requestIp(localRequest), "203.0.113.9");

    const directRequest = {
      socket: { remoteAddress: "198.51.100.7" },
      ip: "198.51.100.7",
      get: () => "203.0.113.9"
    } as unknown as Request;
    assert.equal(requestIp(directRequest), "198.51.100.7");
  });
});

describe("account concurrency limit", () => {
  it("makes account deletion exclusive with other write operations", async () => {
    let releaseWrite!: () => void;
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let releaseDelete!: () => void;
    let markDeleteStarted!: () => void;
    const deleteStarted = new Promise<void>((resolve) => {
      markDeleteStarted = resolve;
    });
    const deleteRelease = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const app = express();
    app.use(
      createConcurrencyLimit({
        key: () => "account-1",
        max: 8,
        exclusive: (req) => req.method === "DELETE" && req.path === "/account"
      })
    );
    app.post("/write", async (_req, res) => {
      markWriteStarted();
      await writeRelease;
      res.json({ ok: true });
    });
    app.delete("/account", async (_req, res) => {
      markDeleteStarted();
      await deleteRelease;
      res.json({ ok: true });
    });
    const server = app.listen(0);
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
      const write = fetch(`${baseUrl}/write`, { method: "POST" });
      await writeStarted;
      const overlappingDelete = await fetch(`${baseUrl}/account`, {
        method: "DELETE"
      });
      assert.equal(overlappingDelete.status, 429);
      releaseWrite();
      assert.equal((await write).status, 200);

      const deletion = fetch(`${baseUrl}/account`, { method: "DELETE" });
      await deleteStarted;
      const overlappingWrite = await fetch(`${baseUrl}/write`, {
        method: "POST"
      });
      assert.equal(overlappingWrite.status, 429);
      releaseDelete();
      assert.equal((await deletion).status, 200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
