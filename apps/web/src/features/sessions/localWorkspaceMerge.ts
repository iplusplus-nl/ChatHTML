import {
  normalizeStoredSessionState,
  type ChatSession,
  type SessionFile,
  type SessionState
} from "../../domain/chat/sessionModel";
import {
  requestSessions,
  saveSerializedSessionState,
  uploadSessionFile,
  type SessionFileUploadInput
} from "./sessionApi";
import {
  nextSessionSaveRevision,
  serializeSessionStateForSave
} from "./sessionPersistence";

type FetchSessions = (clientId: string) => Promise<Response>;
type PersistSessions = (
  serializedState: string,
  clientId: string
) => Promise<Response>;
type UploadFile = (
  sessionId: string,
  input: SessionFileUploadInput,
  clientId: string
) => Promise<SessionFile>;

export type LocalWorkspaceMergeDependencies = {
  requestSessions: FetchSessions;
  persistSessions: PersistSessions;
  uploadFile: UploadFile;
  nextRevision(clientId: string): number;
  now(): number;
};

const defaultDependencies: LocalWorkspaceMergeDependencies = {
  requestSessions,
  persistSessions: (serializedState, clientId) =>
    saveSerializedSessionState(serializedState, clientId),
  uploadFile: uploadSessionFile,
  nextRevision: nextSessionSaveRevision,
  now: Date.now
};

function importedSessionId(localSessionId: string): string {
  return `browser-import:${localSessionId}`;
}

function serverFileIdentity(file: SessionFile): string {
  return JSON.stringify([
    file.kind,
    file.name,
    file.mimeType,
    file.sourceMessageId ?? "",
    file.width ?? null,
    file.height ?? null,
    file.summary ?? ""
  ]);
}

function isServerBackedFile(file: SessionFile): boolean {
  return Boolean(
    file.storageKey || file.contentHash || file.accessToken || file.downloadUrl
  );
}

function matchUploadedFiles(
  localFiles: readonly SessionFile[],
  serverFiles: readonly SessionFile[]
): Map<string, SessionFile> {
  const candidates = new Map<string, SessionFile[]>();
  for (const file of serverFiles.filter(isServerBackedFile)) {
    const identity = serverFileIdentity(file);
    const matches = candidates.get(identity) ?? [];
    matches.push(file);
    candidates.set(identity, matches);
  }

  const result = new Map<string, SessionFile>();
  for (const localFile of localFiles) {
    const matches = candidates.get(serverFileIdentity(localFile));
    const match = matches?.shift();
    if (match) {
      result.set(localFile.id, match);
    }
  }
  return result;
}

function remapMessages(
  session: ChatSession,
  uploadedFiles: ReadonlyMap<string, SessionFile>
): ChatSession["messages"] {
  return session.messages.map((message) => {
    if (!message.fileIds?.length) {
      return message;
    }
    const fileIds = message.fileIds
      .map((fileId) => uploadedFiles.get(fileId)?.id)
      .filter((fileId): fileId is string => Boolean(fileId));
    return {
      ...message,
      fileIds: fileIds.length ? fileIds : undefined
    };
  });
}

function importedSession(
  session: ChatSession,
  uploadedFiles: ReadonlyMap<string, SessionFile>
): ChatSession {
  return {
    ...session,
    id: importedSessionId(session.id),
    messages: remapMessages(session, uploadedFiles),
    files: session.files
      .map((file) => uploadedFiles.get(file.id))
      .filter((file): file is SessionFile => Boolean(file))
  };
}

function mergeImportedSessions(
  accountState: SessionState,
  imports: readonly ChatSession[]
): SessionState {
  const importedIds = new Set(imports.map((session) => session.id));
  return {
    sessions: [
      ...accountState.sessions.filter((session) => !importedIds.has(session.id)),
      ...imports
    ],
    activeSessionId: accountState.activeSessionId
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function sessionVerificationFingerprint(session: ChatSession): string {
  const serialized = JSON.parse(
    serializeSessionStateForSave(
      { sessions: [session], activeSessionId: session.id },
      "local-import-verification",
      [],
      1
    )
  ) as { sessions?: ChatSession[] };
  const normalized = normalizeStoredSessionState(
    { sessions: serialized.sessions ?? [], activeSessionId: session.id }
  ).sessions[0];
  return JSON.stringify(canonicalize(normalized));
}

async function readAccountState(
  clientId: string,
  dependencies: LocalWorkspaceMergeDependencies
): Promise<SessionState> {
  const response = await dependencies.requestSessions(clientId);
  if (!response.ok) {
    throw new Error(`Account sessions could not be loaded (HTTP ${response.status}).`);
  }
  return normalizeStoredSessionState(await response.json(), dependencies.now());
}

async function persistAccountState(
  state: SessionState,
  clientId: string,
  dependencies: LocalWorkspaceMergeDependencies
): Promise<void> {
  const response = await dependencies.persistSessions(
    serializeSessionStateForSave(
      state,
      clientId,
      [],
      dependencies.nextRevision(clientId)
    ),
    clientId
  );
  if (!response.ok) {
    throw new Error(`Account sessions could not be saved (HTTP ${response.status}).`);
  }
  const result = (await response.json().catch(() => null)) as {
    applied?: unknown;
  } | null;
  if (result?.applied === false) {
    throw new Error("A newer account session update won the merge. Please retry.");
  }
}

function uploadInput(file: SessionFile): SessionFileUploadInput {
  if (!file.dataUrl && file.text === undefined) {
    throw new Error(`Local file “${file.name}” no longer has browser content.`);
  }
  return {
    kind: file.kind,
    name: file.name,
    mimeType: file.mimeType,
    dataUrl: file.dataUrl,
    text: file.text,
    width: file.width,
    height: file.height,
    sourceMessageId: file.sourceMessageId,
    summary: file.summary
  };
}

async function runBoundedUploads(
  tasks: ReadonlyArray<() => Promise<void>>,
  concurrency = 4
): Promise<void> {
  let nextTask = 0;
  let firstError: unknown;
  let failed = false;
  const worker = async () => {
    while (nextTask < tasks.length) {
      const task = tasks[nextTask];
      nextTask += 1;
      try {
        await task();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), tasks.length) },
      () => worker()
    )
  );
  if (failed) {
    throw firstError;
  }
}

export async function mergeLocalWorkspaceIntoAccount(
  localState: SessionState,
  clientId: string,
  dependencyOverrides: Partial<LocalWorkspaceMergeDependencies> = {}
): Promise<SessionState> {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const accountState = await readAccountState(clientId, dependencies);
  const uploadedBySession = new Map<string, Map<string, SessionFile>>();

  for (const localSession of localState.sessions) {
    const existing = accountState.sessions.find(
      (session) => session.id === importedSessionId(localSession.id)
    );
    uploadedBySession.set(
      localSession.id,
      matchUploadedFiles(localSession.files, existing?.files ?? [])
    );
  }

  const stagedImports = localState.sessions.map((session) =>
    importedSession(session, uploadedBySession.get(session.id) ?? new Map())
  );
  await persistAccountState(
    mergeImportedSessions(accountState, stagedImports),
    clientId,
    dependencies
  );

  await runBoundedUploads(
    localState.sessions.flatMap((session) => {
      const uploaded = uploadedBySession.get(session.id) ?? new Map();
      uploadedBySession.set(session.id, uploaded);
      return session.files
        .filter((file) => !uploaded.has(file.id))
        .map((file) => async () => {
          const serverFile = await dependencies.uploadFile(
            importedSessionId(session.id),
            uploadInput(file),
            clientId
          );
          uploaded.set(file.id, serverFile);
        });
    })
  );

  const latestAccountState = await readAccountState(clientId, dependencies);
  const completedImports = localState.sessions.map((session) =>
    importedSession(session, uploadedBySession.get(session.id) ?? new Map())
  );
  await persistAccountState(
    mergeImportedSessions(latestAccountState, completedImports),
    clientId,
    dependencies
  );

  const verifiedState = await readAccountState(clientId, dependencies);
  const verifiedById = new Map(
    verifiedState.sessions.map((session) => [session.id, session])
  );
  for (const expected of completedImports) {
    const actual = verifiedById.get(expected.id);
    if (
      !actual ||
      sessionVerificationFingerprint(actual) !==
        sessionVerificationFingerprint(expected)
    ) {
      throw new Error(
        "The imported session content and files could not be verified on the account. Your browser copy was kept."
      );
    }
  }
  return verifiedState;
}
