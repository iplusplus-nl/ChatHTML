import type { Request, Response } from "express";
import "./env.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: unknown[];
  reasoning?: string;
  sessionTitle?: string;
  rawStream?: string;
  hasStreamUi?: boolean;
  streamUiComplete?: boolean;
  status?: "complete" | "error";
  error?: string;
};

type StoredSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredMessage[];
};

type StoredSessionState = {
  sessions: StoredSession[];
  activeSessionId: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "../..");
const sessionsDir = path.resolve(
  process.env.STREAMUI_SESSION_DIR || path.join(workspaceRoot, "sessions")
);
const stateFile = path.join(sessionsDir, "state.json");
const sqliteFile = path.resolve(
  process.env.STREAMUI_SESSION_DB ||
    process.env.STREAMUI_SQLITE_PATH ||
    path.join(sessionsDir, "state.sqlite")
);
const SESSION_STATE_KEY = "global";

let saveQueue = Promise.resolve();
let database: DatabaseSync | null = null;
let sqliteUnavailable = false;

function now(): number {
  return Date.now();
}

function createId(prefix: string): string {
  return `${prefix}-${now()}-${randomUUID().slice(0, 8)}`;
}

function createEmptyState(): StoredSessionState {
  const timestamp = now();
  const session: StoredSession = {
    id: createId("session"),
    title: "New Session",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: []
  };

  return {
    sessions: [session],
    activeSessionId: session.id
  };
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeMessage(input: unknown): StoredMessage | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const message = input as Partial<StoredMessage>;
  if (
    typeof message.id !== "string" ||
    (message.role !== "user" && message.role !== "assistant")
  ) {
    return null;
  }

  return {
    id: message.id,
    role: message.role,
    content: stringValue(message.content),
    attachments: Array.isArray(message.attachments)
      ? message.attachments
      : undefined,
    reasoning: stringValue(message.reasoning) || undefined,
    sessionTitle: stringValue(message.sessionTitle) || undefined,
    rawStream: stringValue(message.rawStream) || undefined,
    hasStreamUi: Boolean(message.hasStreamUi),
    streamUiComplete: Boolean(message.streamUiComplete),
    status:
      message.status === "error"
        ? "error"
        : message.role === "assistant"
          ? "complete"
          : undefined,
    error: stringValue(message.error) || undefined
  };
}

function normalizeSession(input: unknown): StoredSession | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const session = input as Partial<StoredSession>;
  if (typeof session.id !== "string") {
    return null;
  }

  const timestamp = now();
  const createdAt = finiteTimestamp(session.createdAt, timestamp);
  const updatedAt = finiteTimestamp(session.updatedAt, createdAt);
  const messages = Array.isArray(session.messages)
    ? session.messages
        .map(normalizeMessage)
        .filter((message): message is StoredMessage => message !== null)
    : [];

  return {
    id: session.id,
    title: stringValue(session.title, "New Session").trim() || "New Session",
    createdAt,
    updatedAt,
    messages
  };
}

function normalizeState(input: unknown): StoredSessionState {
  if (!input || typeof input !== "object") {
    return createEmptyState();
  }

  const state = input as Partial<StoredSessionState>;
  const sessions = Array.isArray(state.sessions)
    ? state.sessions
        .map(normalizeSession)
        .filter((session): session is StoredSession => session !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    : [];

  if (!sessions.length) {
    return createEmptyState();
  }

  const requestedActiveId =
    typeof state.activeSessionId === "string" ? state.activeSessionId : "";
  const activeSessionId = sessions.some(
    (session) => session.id === requestedActiveId
  )
    ? requestedActiveId
    : sessions[0].id;

  return {
    sessions,
    activeSessionId
  };
}

async function ensureSessionsDir(): Promise<void> {
  await mkdir(path.dirname(sqliteFile), { recursive: true, mode: 0o700 });
}

async function readLegacyJsonState(): Promise<StoredSessionState | null> {
  try {
    const raw = await readFile(stateFile, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code !== "ENOENT") {
      console.warn("Could not read StreamUI sessions.", error);
    }

    return null;
  }
}

async function writeLegacyJsonState(state: StoredSessionState): Promise<void> {
  await mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  await writeFile(stateFile, `${JSON.stringify(normalizeState(state))}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

async function loadDatabaseSync(): Promise<typeof DatabaseSync | null> {
  try {
    const sqlite = await import("node:sqlite");
    return sqlite.DatabaseSync;
  } catch (error) {
    if (!sqliteUnavailable) {
      sqliteUnavailable = true;
      console.warn(
        "SQLite session storage requires Node.js 22.5+; falling back to legacy JSON state.",
        error
      );
    }

    return null;
  }
}

async function getDatabase(): Promise<DatabaseSync | null> {
  if (database) {
    return database;
  }

  const DatabaseSync = await loadDatabaseSync();
  if (!DatabaseSync) {
    return null;
  }

  database = new DatabaseSync(sqliteFile);
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS streamui_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  return database;
}

function readSqliteState(db: DatabaseSync): StoredSessionState | null {
  const row = db
    .prepare("SELECT value FROM streamui_state WHERE key = ?")
    .get(SESSION_STATE_KEY) as { value?: unknown } | undefined;

  if (typeof row?.value !== "string") {
    return null;
  }

  return normalizeState(JSON.parse(row.value));
}

function writeSqliteState(db: DatabaseSync, state: StoredSessionState): void {
  const normalized = normalizeState(state);
  db.prepare(
    `
      INSERT INTO streamui_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
  ).run(
    SESSION_STATE_KEY,
    JSON.stringify(normalized),
    now()
  );
}

async function readSessionState(): Promise<StoredSessionState> {
  await ensureSessionsDir();
  const db = await getDatabase();

  if (!db) {
    return (await readLegacyJsonState()) ?? createEmptyState();
  }

  try {
    const sqliteState = readSqliteState(db);
    if (sqliteState) {
      return sqliteState;
    }
  } catch (error) {
    console.warn("Could not read StreamUI SQLite sessions.", error);
  }

  const legacyState = await readLegacyJsonState();
  const state = legacyState ?? createEmptyState();
  writeSqliteState(db, state);
  return state;
}

async function writeSessionState(state: StoredSessionState): Promise<void> {
  await ensureSessionsDir();
  const db = await getDatabase();
  if (!db) {
    await writeLegacyJsonState(state);
    return;
  }

  writeSqliteState(db, state);
}

export async function handleGetSessions(
  _req: Request,
  res: Response
): Promise<void> {
  try {
    res.json(await readSessionState());
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function handleSaveSessions(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const state = normalizeState(req.body);
    saveQueue = saveQueue.then(() => writeSessionState(state));
    await saveQueue;
    res.json({ ok: true });
  } catch (error) {
    saveQueue = Promise.resolve();
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
