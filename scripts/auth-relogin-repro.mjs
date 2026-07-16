#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, request } from "playwright";

const confirmation = "--confirm-production-audit";
if (!process.argv.includes(confirmation)) {
  throw new Error(`Refusing to run without ${confirmation}.`);
}

const appBase = (
  process.env.CHATHTML_AUDIT_APP_BASE ?? "https://chat.aietheia.com"
).replace(/\/+$/, "");
const serviceBase = (
  process.env.CHATHTML_AUDIT_SERVICE_BASE ?? "https://service.aietheia.com"
).replace(/\/+$/, "");
const email = `codex-relogin-${Date.now()}@example.com`;
const password = `Alpha!${randomBytes(18).toString("base64url")}9Z`;
const api = await request.newContext({ baseURL: serviceBase });
const created = await api.post("/v1/auth/register", {
  data: { email, password, alphaConsent: "accepted" },
});
if (!created.ok()) throw new Error(`registration failed: ${created.status()} ${await created.text()}`);
const session = await created.json();
console.log(`REGISTER status=${created.status()} user=${session.user.id}`);

let browser;
let context;
let page;
const events = [];

async function openOAuth() {
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  if (await signIn.isVisible().catch(() => false)) await signIn.click();
  else await page.getByRole("button", { name: "Sign in to ChatHTML" }).click();
  await page.waitForURL((url) => url.origin === new URL(serviceBase).origin, { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByLabel("Email").waitFor();
  console.log(
    `OAUTH url=${page.url()} docOrigin=${await page.evaluate(() => location.origin)} ready=${await page.evaluate(() => document.readyState)}`,
  );
}

async function submitLogin(label) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  console.log(
    `${label} form=${await page.locator("form").getAttribute("action")} origin=${await page.evaluate(() => location.origin)}`,
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.origin === new URL(appBase).origin, { timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: /Open (account|personal) settings/i }).first().waitFor();
  console.log(`${label} SUCCESS ${page.url()}`);
}

let failure = "";
let firstLoginSucceeded = false;
let secondLoginSucceeded = false;
try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      events.push({ kind: `console-${message.type()}`, text: message.text() });
      console.log(`CONSOLE ${message.type()} ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    events.push({ kind: "pageerror", text: error.stack ?? error.message });
    console.log(`PAGEERROR ${error.stack ?? error.message}`);
  });

  await page.goto(appBase, { waitUntil: "networkidle" });
  await openOAuth();
  await submitLogin("FIRST");
  firstLoginSucceeded = true;

  await page.getByRole("button", { name: /Open (account|personal) settings/i }).first().click();
  await page.locator(".settings-panel").waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Choose how to use ChatHTML" }).waitFor();
  console.log(`SIGNED OUT origin=${await page.evaluate(() => location.origin)}`);

  await openOAuth();
  await submitLogin("SECOND");
  secondLoginSucceeded = true;
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.log(`REPRO FAILURE ${failure.split("\n")[0]}`);
} finally {
  let cleanupStatus = 0;
  try {
    const deleted = await api.delete("/v1/auth/account", {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    cleanupStatus = deleted.status();
    console.log(`DELETE status=${cleanupStatus}`);
  } catch (error) {
    const cleanupFailure = error instanceof Error ? error.message : String(error);
    failure ||= `account cleanup failed: ${cleanupFailure}`;
    console.log(`DELETE FAILED ${cleanupFailure.split("\n")[0]}`);
  }
  const output = path.resolve("test-results", "production-alpha-audit");
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, "auth-login-repro.json"),
    JSON.stringify(
      {
        firstLoginSucceeded,
        secondLoginSucceeded,
        failure: failure.split("\n")[0],
        cspFormActionViolation: events.some((event) =>
          event.text.includes("form-action 'self'"),
        ),
        events,
        cleanupStatus,
      },
      null,
      2,
    ),
  );
  await browser?.close().catch(() => undefined);
  await api.dispose();
  if (
    !firstLoginSucceeded ||
    !secondLoginSucceeded ||
    failure ||
    cleanupStatus !== 200 ||
    events.some(
      (event) =>
        event.kind === "pageerror" ||
        /content security policy|form-action/i.test(event.text),
    )
  ) {
    process.exitCode = 1;
  }
}
