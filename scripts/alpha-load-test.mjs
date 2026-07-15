#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

const confirmation = "--confirm-production-load-test";
if (!process.argv.includes(confirmation)) {
  throw new Error(`Refusing to run without ${confirmation}.`);
}

const requestedUsers = Number(
  process.argv.find((arg) => arg.startsWith("--users="))?.split("=", 2)[1] ??
    process.env.CHATHTML_LOAD_USERS ??
    75
);
if (!Number.isInteger(requestedUsers) || requestedUsers < 50 || requestedUsers > 100) {
  throw new Error("--users must be an integer from 50 through 100.");
}

const appBase = (
  process.env.CHATHTML_LOAD_APP_BASE ?? "http://127.0.0.1:8787"
).replace(/\/+$/, "");
const serviceBase = (
  process.env.CHATHTML_LOAD_SERVICE_BASE ?? "http://127.0.0.1:18790/v1"
).replace(/\/+$/, "");
const timeoutMs = Number(process.env.CHATHTML_LOAD_TIMEOUT_MS ?? 30_000);
const runId = `${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
const phaseMetrics = new Map();

function testIp(index) {
  return `198.18.${Math.floor(index / 250)}.${(index % 250) + 1}`;
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function record(phase, durationMs) {
  const values = phaseMetrics.get(phase) ?? [];
  values.push(durationMs);
  phaseMetrics.set(phase, values);
}

async function request(phase, url, init = {}, expected = [200]) {
  const started = performance.now();
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error"
  });
  const text = await response.text();
  record(phase, performance.now() - started);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${phase} returned HTTP ${response.status}: ${text.slice(0, 240)}`
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${phase} returned invalid JSON.`);
  }
}

function jsonInit(body, headers = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  };
}

function serviceHeaders(user, token = "") {
  return {
    "X-Forwarded-For": user.ip,
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

function appHeaders(user, token, extra = {}) {
  return {
    "X-Real-IP": user.ip,
    Cookie: `chathtml_service_session=${token}`,
    ...extra
  };
}

function cookieInit(user, token, init = {}) {
  return {
    ...init,
    headers: appHeaders(user, token, init.headers ?? {})
  };
}

async function phase(name, users, operation) {
  const started = performance.now();
  const results = await Promise.allSettled(users.map(operation));
  const errors = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`user ${index + 1}: ${String(result.reason)}`]
      : []
  );
  const elapsedMs = performance.now() - started;
  process.stdout.write(
    `${name}: ${users.length - errors.length}/${users.length} succeeded in ${elapsedMs.toFixed(1)} ms\n`
  );
  if (errors.length) {
    throw new Error(`${name} failed:\n${errors.slice(0, 10).join("\n")}`);
  }
}

const users = Array.from({ length: requestedUsers }, (_, index) => {
  const marker = `alpha-load-${runId}-${index + 1}`;
  return {
    index,
    ip: testIp(index),
    email: `${marker}@example.invalid`,
    password: `Orbit-${randomBytes(18).toString("base64url")}-before`,
    newPassword: `Orbit-${randomBytes(18).toString("base64url")}-after`,
    marker,
    sessionId: `session-${marker}`,
    clientId: `client-${runId}-${index + 1}`,
    hasAppState: false
  };
});

async function loginForCleanup(user) {
  for (const password of [user.newPassword, user.password]) {
    try {
      const session = await request(
        "cleanup-login",
        `${serviceBase}/auth/login`,
        jsonInit(
          { email: user.email, password },
          serviceHeaders(user)
        )
      );
      return session.accessToken;
    } catch {
      // Try the other password; recovery may or may not have completed.
    }
  }
  return user.latestToken ?? user.loginToken ?? user.registrationToken ?? "";
}

async function cleanupUser(user) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = await loginForCleanup(user);
    if (!token) continue;
    try {
      if (user.hasAppState) {
        await request(
          "cleanup-account",
          `${appBase}/api/account`,
          cookieInit(user, token, { method: "DELETE" })
        );
      } else {
        await request(
          "cleanup-account",
          `${serviceBase}/auth/account`,
          {
            method: "DELETE",
            headers: serviceHeaders(user, token)
          }
        );
      }
      user.cleaned = true;
      return;
    } catch {
      // Retry with a freshly authenticated token.
    }
  }
}

let primaryError;
try {
  await phase("register", users, async (user) => {
    const session = await request(
      "register",
      `${serviceBase}/auth/register`,
      jsonInit(
        {
          email: user.email,
          password: user.password,
          alphaConsent: "accepted"
        },
        serviceHeaders(user)
      ),
      [201]
    );
    user.registrationToken = session.accessToken;
    user.recoveryCode = session.recoveryCode;
  });

  await phase("login", users, async (user) => {
    const session = await request(
      "login",
      `${serviceBase}/auth/login`,
      jsonInit(
        { email: user.email, password: user.password },
        serviceHeaders(user)
      )
    );
    user.loginToken = session.accessToken;
    user.latestToken = session.accessToken;
  });

  await phase("session-write", users, async (user) => {
    const now = Date.now();
    const state = {
      activeSessionId: user.sessionId,
      sessions: [
        {
          id: user.sessionId,
          title: user.marker,
          createdAt: now,
          updatedAt: now,
          messages: [
            { id: `message-${user.marker}`, role: "user", content: user.marker }
          ],
          files: []
        }
      ],
      deletedSessionIds: [],
      clientId: user.clientId,
      saveRevision: 1
    };
    await request(
      "session-write",
      `${appBase}/api/sessions`,
      cookieInit(user, user.loginToken, jsonInit(state))
    );
    user.hasAppState = true;
  });

  await phase("session-read", users, async (user) => {
    const state = await request(
      "session-read",
      `${appBase}/api/sessions`,
      cookieInit(user, user.loginToken)
    );
    if (state.sessions?.[0]?.messages?.[0]?.content !== user.marker) {
      throw new Error("session marker was not isolated or persisted");
    }
  });

  await phase("file-upload", users, async (user) => {
    const text = `${user.marker}\n${"load-test-file-data\n".repeat(200)}`;
    const uploaded = await request(
      "file-upload",
      `${appBase}/api/sessions/${encodeURIComponent(user.sessionId)}/files`,
      cookieInit(
        user,
        user.loginToken,
        jsonInit({
          kind: "text",
          name: `${user.marker}.txt`,
          mimeType: "text/plain",
          text,
          draft: false
        })
      )
    );
    if (uploaded.file?.name !== `${user.marker}.txt`) {
      throw new Error("uploaded file metadata did not match");
    }
  });

  await phase("session-update", users, async (user) => {
    const state = await request(
      "session-read-for-update",
      `${appBase}/api/sessions`,
      cookieInit(user, user.loginToken)
    );
    state.sessions[0].messages.push({
      id: `assistant-${user.marker}`,
      role: "assistant",
      content: `confirmed-${user.marker}`,
      status: "complete"
    });
    state.clientId = user.clientId;
    state.saveRevision = 2;
    await request(
      "session-update",
      `${appBase}/api/sessions`,
      cookieInit(user, user.loginToken, {
        ...jsonInit(state),
        method: "PUT"
      })
    );
  });

  await phase("file-list", users, async (user) => {
    const body = await request(
      "file-list",
      `${appBase}/api/sessions/${encodeURIComponent(user.sessionId)}/files`,
      cookieInit(user, user.loginToken)
    );
    if (body.files?.length !== 1 || body.files[0]?.name !== `${user.marker}.txt`) {
      throw new Error("file list did not contain the account's uploaded file");
    }
  });

  await phase("account-export", users, async (user) => {
    const exported = await request(
      "account-export",
      `${appBase}/api/account/export`,
      cookieInit(user, user.loginToken)
    );
    const session = exported.state?.sessions?.[0];
    const encoded = session?.files?.[0]?.exportedContent?.data;
    if (
      session?.title !== user.marker ||
      !session.messages?.some(
        (message) => message.content === `confirmed-${user.marker}`
      ) ||
      typeof encoded !== "string" ||
      !Buffer.from(encoded, "base64").toString("utf8").includes(user.marker)
    ) {
      throw new Error("account export was incomplete or crossed account data");
    }
  });

  await phase("account-recovery", users, async (user) => {
    const session = await request(
      "account-recovery",
      `${serviceBase}/auth/recover`,
      jsonInit(
        {
          email: user.email,
          recoveryCode: user.recoveryCode,
          newPassword: user.newPassword
        },
        serviceHeaders(user)
      )
    );
    user.latestToken = session.accessToken;
    user.recoveryCode = session.recoveryCode;
  });

  await phase("revocation-check", users, async (user) => {
    await request(
      "revocation-check",
      `${appBase}/api/sessions`,
      cookieInit(user, user.loginToken),
      [401]
    );
  });

  await phase("new-password-login", users, async (user) => {
    const session = await request(
      "new-password-login",
      `${serviceBase}/auth/login`,
      jsonInit(
        { email: user.email, password: user.newPassword },
        serviceHeaders(user)
      )
    );
    user.latestToken = session.accessToken;
  });

  await phase("post-recovery-read", users, async (user) => {
    const state = await request(
      "post-recovery-read",
      `${appBase}/api/sessions`,
      cookieInit(user, user.latestToken)
    );
    if (state.sessions?.[0]?.title !== user.marker) {
      throw new Error("account data was not preserved through recovery");
    }
  });
} catch (error) {
  primaryError = error;
  process.stderr.write(`${String(error)}\n`);
} finally {
  await phase("cleanup", users, cleanupUser).catch((error) => {
    primaryError ??= error;
    process.stderr.write(`${String(error)}\n`);
  });
}

const uncleaned = users.filter((user) => user.registrationToken && !user.cleaned);
const metrics = Object.fromEntries(
  Array.from(phaseMetrics, ([name, raw]) => {
    const values = [...raw].sort((a, b) => a - b);
    return [
      name,
      {
        requests: values.length,
        p50Ms: Number(percentile(values, 0.5).toFixed(1)),
        p95Ms: Number(percentile(values, 0.95).toFixed(1)),
        p99Ms: Number(percentile(values, 0.99).toFixed(1)),
        maxMs: Number((values.at(-1) ?? 0).toFixed(1))
      }
    ];
  })
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: !primaryError && uncleaned.length === 0,
      users: requestedUsers,
      runId,
      uncleanedAccounts: uncleaned.length,
      metrics
    },
    null,
    2
  )}\n`
);

if (uncleaned.length) {
  process.stderr.write(
    `Cleanup failed for: ${uncleaned.map((user) => user.email).join(", ")}\n`
  );
}
if (primaryError || uncleaned.length) process.exitCode = 1;

