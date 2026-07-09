#!/usr/bin/env node

const healthUrl =
  process.env.CHATHTML_HEALTH_URL ||
  process.argv[2] ||
  "https://chat.aietheia.com/api/health";
const idleMs = readDuration("CHATHTML_DEPLOY_IDLE_MS", 30_000);
const timeoutMs = readDuration("CHATHTML_DEPLOY_WAIT_TIMEOUT_MS", 10 * 60_000);
const pollMs = readDuration("CHATHTML_DEPLOY_POLL_MS", 1_000);
const deployToken = process.env.CHATHTML_DEPLOY_TOKEN?.trim() ?? "";
const skipDrain = process.env.CHATHTML_SKIP_DRAIN === "1";
const drainUrl =
  process.env.CHATHTML_DRAIN_URL || deriveDrainUrl(healthUrl);

function readDuration(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function deriveDrainUrl(input) {
  const url = new URL(input);
  url.pathname = url.pathname.replace(/\/api\/health\/?$/, "/api/admin/drain");
  url.search = "";
  return url.toString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { text };
  }
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${url} failed with HTTP ${response.status}: ${text.slice(0, 240)}`
    );
  }
  return payload;
}

async function enableDrain() {
  if (skipDrain) {
    console.log("[deploy-wait] skipping drain request");
    return;
  }
  if (!deployToken) {
    throw new Error("CHATHTML_DEPLOY_TOKEN is required to enable deploy drain.");
  }

  await requestJson(drainUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deployToken}`
    }
  });
  console.log(`[deploy-wait] drain enabled at ${drainUrl}`);
}

function parseActivity(payload) {
  const activity = payload?.activity;
  if (!activity || typeof activity !== "object") {
    throw new Error("Health response does not include activity metrics.");
  }
  return {
    activeTasks: Number(activity.activeTasks ?? 0),
    idleForMs: Number(activity.idleForMs ?? 0),
    draining: Boolean(activity.draining),
    runningChatRuns: Number(activity.runningChatRuns ?? 0),
    activeChatFinalizations: Number(activity.activeChatFinalizations ?? 0),
    activeArtifactEdits: Number(activity.activeArtifactEdits ?? 0)
  };
}

await enableDrain();

const started = Date.now();
let lastLogAt = 0;

while (true) {
  const payload = await requestJson(healthUrl);
  const activity = parseActivity(payload);
  if (activity.activeTasks === 0 && activity.idleForMs >= idleMs) {
    console.log(
      `[deploy-wait] ready active_tasks=0 idle_ms=${Math.round(activity.idleForMs)}`
    );
    process.exit(0);
  }

  const now = Date.now();
  if (now - lastLogAt >= 5_000) {
    console.log(
      `[deploy-wait] waiting active_tasks=${activity.activeTasks} chat_runs=${activity.runningChatRuns} finalizations=${activity.activeChatFinalizations} artifact_edits=${activity.activeArtifactEdits} idle_ms=${Math.round(activity.idleForMs)} draining=${activity.draining}`
    );
    lastLogAt = now;
  }

  if (now - started >= timeoutMs) {
    console.error(
      `[deploy-wait] timed out active_tasks=${activity.activeTasks} idle_ms=${Math.round(activity.idleForMs)}`
    );
    process.exit(1);
  }

  await delay(pollMs);
}
