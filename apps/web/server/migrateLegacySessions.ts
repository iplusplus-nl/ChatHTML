import "./env.js";
import { createHash, randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { normalizeStoredSessionState } from "./sessionStateModel.js";
import type {
  StoredSessionFile,
  StoredSessionState
} from "./sessionStateTypes.js";

type MigrationOptions = {
  databaseUrl: string;
  sqliteFile: string;
  sourceKey?: string;
  targetUserId: string;
};

export type LegacySessionMigrationResult = {
  alreadyMigrated: boolean;
  targetStateKey: string;
  sessions: number;
  messages: number;
  files: number;
  sourceSha256: string;
  targetSha256: string;
};

function stateSha256(state: StoredSessionState): string {
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function countState(state: StoredSessionState): Pick<
  LegacySessionMigrationResult,
  "sessions" | "messages" | "files"
> {
  return {
    sessions: state.sessions.length,
    messages: state.sessions.reduce(
      (total, session) => total + session.messages.length,
      0
    ),
    files: state.sessions.reduce(
      (total, session) => total + (session.files?.length ?? 0),
      0
    )
  };
}

function capabilityHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isPlaceholderState(state: StoredSessionState): boolean {
  return (
    state.sessions.length <= 1 &&
    state.sessions.every(
      (session) =>
        session.messages.length === 0 &&
        (session.files?.length ?? 0) === 0 &&
        !session.bugReportDraft
    )
  );
}

export function rotateStateFileCapabilities(
  input: StoredSessionState,
  createToken = () => randomBytes(32).toString("base64url")
): StoredSessionState {
  return {
    ...input,
    sessions: input.sessions.map((session) => ({
      ...session,
      files: session.files?.map((file) => {
        if (!file.accessToken) {
          return file;
        }
        const rotated: StoredSessionFile = {
          ...file,
          accessToken: createToken()
        };
        delete rotated.embedUrl;
        delete rotated.downloadUrl;
        return rotated;
      })
    }))
  };
}

async function ensurePostgresSchema(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS chathtml_state (
      state_key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS chathtml_file_capability (
      file_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      state_key TEXT NOT NULL REFERENCES chathtml_state(state_key)
        ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      file_json JSONB NOT NULL,
      PRIMARY KEY (file_id, token_hash)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS chathtml_file_capability_state_idx
      ON chathtml_file_capability(state_key)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS chathtml_migration (
      migration_key TEXT PRIMARY KEY,
      source_sha256 TEXT NOT NULL,
      target_sha256 TEXT NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function readSqliteState(
  sqliteFile: string,
  sourceKey: string
): Promise<StoredSessionState> {
  await stat(sqliteFile);
  const [{ open }, sqlite3] = await Promise.all([
    import("sqlite"),
    import("sqlite3")
  ]);
  const driver = sqlite3.default?.Database ?? sqlite3.Database;
  const db = await open({ filename: sqliteFile, driver });
  try {
    const row = (await db.get(
      "SELECT value FROM streamui_state WHERE key = ?",
      sourceKey
    )) as { value?: unknown } | undefined;
    if (!row || typeof row.value !== "string") {
      throw new Error(
        `No readable SQLite session state exists for key ${JSON.stringify(sourceKey)}.`
      );
    }
    return normalizeStoredSessionState(JSON.parse(row.value));
  } finally {
    await db.close();
  }
}

function parsePostgresState(value: unknown): StoredSessionState {
  return normalizeStoredSessionState(
    typeof value === "string" ? JSON.parse(value) : value
  );
}

export async function migrateLegacySessions({
  databaseUrl,
  sqliteFile,
  sourceKey = "global",
  targetUserId
}: MigrationOptions): Promise<LegacySessionMigrationResult> {
  if (!databaseUrl.trim()) {
    throw new Error("CHATHTML_DATABASE_URL is required for session migration.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    throw new Error("CHATHTML_MIGRATION_USER_ID must be a UUID.");
  }

  const normalizedSource = await readSqliteState(path.resolve(sqliteFile), sourceKey);
  const sourceSha256 = stateSha256(normalizedSource);
  const targetStateKey = `user:${targetUserId.toLowerCase()}`;
  const migrationKey = `legacy-state:${sourceKey}:${targetStateKey}`;
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: "chathtml-session-migration"
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [migrationKey]);
    await ensurePostgresSchema(client);

    const priorMigration = await client.query(
      `SELECT source_sha256, target_sha256
       FROM chathtml_migration WHERE migration_key = $1`,
      [migrationKey]
    );
    if (priorMigration.rowCount) {
      const prior = priorMigration.rows[0] as {
        source_sha256: string;
        target_sha256: string;
      };
      if (prior.source_sha256 !== sourceSha256) {
        throw new Error("The legacy source changed after it was migrated.");
      }
      const existing = await client.query(
        "SELECT value FROM chathtml_state WHERE state_key = $1",
        [targetStateKey]
      );
      if (!existing.rowCount) {
        throw new Error("The migration marker exists but its target state is missing.");
      }
      const targetState = parsePostgresState(existing.rows[0].value);
      if (stateSha256(targetState) !== prior.target_sha256) {
        throw new Error("The migrated target changed after its migration marker was written.");
      }
      await client.query("COMMIT");
      return {
        alreadyMigrated: true,
        targetStateKey,
        ...countState(targetState),
        sourceSha256,
        targetSha256: prior.target_sha256
      };
    }

    const existing = await client.query(
      "SELECT value FROM chathtml_state WHERE state_key = $1 FOR UPDATE",
      [targetStateKey]
    );
    if (
      existing.rowCount &&
      !isPlaceholderState(parsePostgresState(existing.rows[0].value))
    ) {
      throw new Error("The target user already has session content; refusing to overwrite it.");
    }

    const targetState = rotateStateFileCapabilities(normalizedSource);
    const targetSha256 = stateSha256(targetState);
    await client.query(
      `INSERT INTO chathtml_state (state_key, value, updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (state_key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [targetStateKey, JSON.stringify(targetState), Date.now()]
    );
    await client.query(
      "DELETE FROM chathtml_file_capability WHERE state_key = $1",
      [targetStateKey]
    );
    for (const session of targetState.sessions) {
      for (const file of session.files ?? []) {
        if (!file.accessToken) {
          continue;
        }
        await client.query(
          `INSERT INTO chathtml_file_capability (
             file_id, token_hash, state_key, session_id, file_json
           ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            file.id,
            capabilityHash(file.accessToken),
            targetStateKey,
            session.id,
            JSON.stringify(file)
          ]
        );
      }
    }
    await client.query(
      `INSERT INTO chathtml_migration (
         migration_key, source_sha256, target_sha256
       ) VALUES ($1, $2, $3)`,
      [migrationKey, sourceSha256, targetSha256]
    );
    await client.query("COMMIT");

    const verification = await client.query(
      "SELECT value FROM chathtml_state WHERE state_key = $1",
      [targetStateKey]
    );
    const verifiedState = parsePostgresState(verification.rows[0]?.value);
    if (stateSha256(verifiedState) !== targetSha256) {
      throw new Error("PostgreSQL migration verification failed.");
    }
    return {
      alreadyMigrated: false,
      targetStateKey,
      ...countState(verifiedState),
      sourceSha256,
      targetSha256
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.CHATHTML_DATABASE_URL?.trim() ?? "";
  const sqliteFile =
    process.env.STREAMUI_SESSION_DB?.trim() ||
    path.resolve(process.cwd(), "sessions/state.sqlite");
  const targetUserId = process.env.CHATHTML_MIGRATION_USER_ID?.trim() ?? "";
  const sourceKey = process.env.CHATHTML_MIGRATION_SOURCE_KEY?.trim() || "global";
  const result = await migrateLegacySessions({
    databaseUrl,
    sqliteFile,
    sourceKey,
    targetUserId
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
