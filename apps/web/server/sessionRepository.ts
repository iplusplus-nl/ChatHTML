import "./env.js";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as SqliteDatabase } from "sqlite";
import {
  createEmptySessionState,
  normalizeStoredSessionState,
  sessionStateNow
} from "./sessionStateModel.js";
import type { StoredSessionState } from "./sessionStateTypes.js";

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

export const DEFAULT_SESSION_STATE_KEY = "global";

let saveQueue = Promise.resolve();
let database: SqliteDatabase | null = null;

async function ensureSessionsDir(): Promise<void> {
  await mkdir(path.dirname(sqliteFile), { recursive: true, mode: 0o700 });
}

async function readLegacyJsonState(): Promise<StoredSessionState | null> {
  try {
    const raw = await readFile(stateFile, "utf8");
    return normalizeStoredSessionState(JSON.parse(raw));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function getDatabase(): Promise<SqliteDatabase> {
  if (database) {
    return database;
  }

  const [{ open }, sqlite3] = await Promise.all([
    import("sqlite"),
    import("sqlite3")
  ]);
  const driver = sqlite3.default?.Database ?? sqlite3.Database;

  database = await open({
    filename: sqliteFile,
    driver
  });
  await database.exec("PRAGMA busy_timeout = 5000");
  await database.exec("PRAGMA journal_mode = WAL");
  await database.exec("PRAGMA synchronous = NORMAL");
  await database.exec(`
    CREATE TABLE IF NOT EXISTS streamui_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  return database;
}

async function readSqliteState(
  db: SqliteDatabase,
  stateKey: string
): Promise<StoredSessionState | null> {
  const row = (await db.get(
    "SELECT value FROM streamui_state WHERE key = ?",
    stateKey
  )) as { value?: unknown } | undefined;

  if (!row) {
    return null;
  }

  if (typeof row.value !== "string") {
    throw new TypeError(
      `ChatHTML session row ${JSON.stringify(stateKey)} has a non-text value.`
    );
  }

  return normalizeStoredSessionState(JSON.parse(row.value));
}

async function writeSqliteState(
  db: SqliteDatabase,
  state: StoredSessionState,
  stateKey: string
): Promise<void> {
  const normalized = normalizeStoredSessionState(state);
  await db.run(
    `
      INSERT INTO streamui_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    stateKey,
    JSON.stringify(normalized),
    sessionStateNow()
  );
}

export async function readSessionState(
  stateKey = DEFAULT_SESSION_STATE_KEY
): Promise<StoredSessionState> {
  await ensureSessionsDir();
  const db = await getDatabase();

  const sqliteState = await readSqliteState(db, stateKey);
  if (sqliteState) {
    return sqliteState;
  }

  const legacyState =
    stateKey === DEFAULT_SESSION_STATE_KEY ? await readLegacyJsonState() : null;
  const state = legacyState ?? createEmptySessionState();
  await writeSqliteState(db, state, stateKey);
  return state;
}

export async function writeSessionState(
  state: StoredSessionState,
  stateKey = DEFAULT_SESSION_STATE_KEY
): Promise<void> {
  await ensureSessionsDir();
  const db = await getDatabase();
  await writeSqliteState(db, state, stateKey);
}

export async function readAllSessionStates(): Promise<StoredSessionState[]> {
  await ensureSessionsDir();
  const db = await getDatabase();
  const rows = (await db.all("SELECT value FROM streamui_state")) as Array<{
    value?: unknown;
  }>;
  const states: StoredSessionState[] = [];
  for (const row of rows) {
    if (typeof row.value !== "string") {
      continue;
    }
    try {
      states.push(normalizeStoredSessionState(JSON.parse(row.value)));
    } catch (error) {
      console.warn("Could not parse ChatHTML session row.", error);
    }
  }
  return states;
}

export async function enqueueSessionRepositoryOperation<T>(
  operation: () => Promise<T>
): Promise<T> {
  const queued = saveQueue.then(operation);
  saveQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}

export async function enqueueSessionStateUpdate(
  stateKey: string,
  updater: (state: StoredSessionState) => void | StoredSessionState
): Promise<void> {
  await enqueueSessionRepositoryOperation(async () => {
    const state = await readSessionState(stateKey);
    const updated = updater(state) ?? state;
    await writeSessionState(updated, stateKey);
  });
}

export async function enqueueSessionStateInspection(
  stateKey: string,
  inspector: (state: StoredSessionState) => void
): Promise<void> {
  await enqueueSessionRepositoryOperation(async () => {
    inspector(await readSessionState(stateKey));
  });
}
