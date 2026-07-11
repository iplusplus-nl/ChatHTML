export type ChatRunRuntimeIdentity = Readonly<{
  runId: string;
  sessionId: string;
  assistantId: string;
}>;

export type ChatRunRuntime<Execution> = {
  readonly identity: ChatRunRuntimeIdentity;
  isAccepted(): boolean;
  waitUntilAccepted(): Promise<boolean>;
  getExecution(): Execution | undefined;
  waitUntilExecution(): Promise<Execution | undefined>;
};

export type ChatRunExecutionDetach = () => boolean;

export type ChatRunRuntimeRegistration<Execution> =
  ChatRunRuntime<Execution> & {
    markAccepted(): boolean;
    attachExecution(
      execution: Execution
    ): ChatRunExecutionDetach | undefined;
    end(): boolean;
  };

export type ChatRunRuntimeRegistry<Execution> = {
  registerFresh(
    identity: ChatRunRuntimeIdentity,
    options?: { initiallyAccepted?: boolean }
  ): ChatRunRuntimeRegistration<Execution>;
  registerRestored(
    identity: ChatRunRuntimeIdentity
  ): ChatRunRuntimeRegistration<Execution>;
  get(identity: ChatRunRuntimeIdentity): ChatRunRuntime<Execution> | undefined;
  getExecution(identity: ChatRunRuntimeIdentity): Execution | undefined;
};

type ExecutionAttachment<Execution> = {
  execution: Execution;
  token: object;
};

type ExecutionWaiter<Execution> = (
  execution: Execution | undefined
) => void;

type RuntimeEntry<Execution> = {
  identity: ChatRunRuntimeIdentity;
  accepted: boolean;
  acceptancePromise: Promise<boolean>;
  resolveAcceptance: (accepted: boolean) => void;
  acceptanceSettled: boolean;
  attachment?: ExecutionAttachment<Execution>;
  executionWaiters: Set<ExecutionWaiter<Execution>>;
  runtime: ChatRunRuntime<Execution>;
};

function identityKey(identity: ChatRunRuntimeIdentity): string {
  return JSON.stringify([
    identity.runId,
    identity.sessionId,
    identity.assistantId
  ]);
}

function snapshotIdentity(
  identity: ChatRunRuntimeIdentity
): ChatRunRuntimeIdentity {
  return Object.freeze({
    runId: identity.runId,
    sessionId: identity.sessionId,
    assistantId: identity.assistantId
  });
}

export function createChatRunRuntimeRegistry<Execution>(): ChatRunRuntimeRegistry<Execution> {
  const entries = new Map<string, RuntimeEntry<Execution>>();

  const isCurrent = (key: string, entry: RuntimeEntry<Execution>) =>
    entries.get(key) === entry;

  const settleAcceptance = (
    entry: RuntimeEntry<Execution>,
    accepted: boolean
  ) => {
    if (entry.acceptanceSettled) {
      return;
    }
    entry.acceptanceSettled = true;
    entry.resolveAcceptance(accepted);
  };

  const settleExecutionWaiters = (
    entry: RuntimeEntry<Execution>,
    execution: Execution | undefined
  ) => {
    const waiters = Array.from(entry.executionWaiters);
    entry.executionWaiters.clear();
    for (const resolve of waiters) {
      resolve(execution);
    }
  };

  const retire = (entry: RuntimeEntry<Execution>) => {
    settleAcceptance(entry, entry.accepted);
    settleExecutionWaiters(entry, undefined);
  };

  const register = (
    requestedIdentity: ChatRunRuntimeIdentity,
    initiallyAccepted: boolean
  ): ChatRunRuntimeRegistration<Execution> => {
    const identity = snapshotIdentity(requestedIdentity);
    const key = identityKey(identity);
    const previous = entries.get(key);
    if (previous) {
      entries.delete(key);
      retire(previous);
    }

    let resolveAcceptance!: (accepted: boolean) => void;
    const acceptancePromise = new Promise<boolean>((resolve) => {
      resolveAcceptance = resolve;
    });

    const entry = {
      identity,
      accepted: initiallyAccepted,
      acceptancePromise,
      resolveAcceptance,
      acceptanceSettled: false,
      executionWaiters: new Set<ExecutionWaiter<Execution>>()
    } as RuntimeEntry<Execution>;

    if (initiallyAccepted) {
      settleAcceptance(entry, true);
    }

    const runtime: ChatRunRuntime<Execution> = {
      identity,
      isAccepted: () => isCurrent(key, entry) && entry.accepted,
      waitUntilAccepted: () => entry.acceptancePromise,
      getExecution: () =>
        isCurrent(key, entry) ? entry.attachment?.execution : undefined,
      waitUntilExecution: () => {
        if (!isCurrent(key, entry)) {
          return Promise.resolve(undefined);
        }
        if (entry.attachment) {
          return Promise.resolve(entry.attachment.execution);
        }
        return new Promise<Execution | undefined>((resolve) => {
          if (!isCurrent(key, entry)) {
            resolve(undefined);
            return;
          }
          entry.executionWaiters.add(resolve);
        });
      }
    };
    entry.runtime = runtime;
    entries.set(key, entry);

    return {
      ...runtime,
      markAccepted: () => {
        if (!isCurrent(key, entry)) {
          return false;
        }
        entry.accepted = true;
        settleAcceptance(entry, true);
        return true;
      },
      attachExecution: (execution) => {
        if (!isCurrent(key, entry)) {
          return undefined;
        }

        const attachment: ExecutionAttachment<Execution> = {
          execution,
          token: {}
        };
        entry.attachment = attachment;
        settleExecutionWaiters(entry, execution);

        return () => {
          if (
            !isCurrent(key, entry) ||
            entry.attachment?.token !== attachment.token
          ) {
            return false;
          }
          entry.attachment = undefined;
          return true;
        };
      },
      end: () => {
        if (!isCurrent(key, entry)) {
          return false;
        }
        entries.delete(key);
        retire(entry);
        return true;
      }
    };
  };

  return {
    registerFresh: (identity, options) =>
      register(identity, options?.initiallyAccepted ?? false),
    registerRestored: (identity) => register(identity, true),
    get: (identity) => entries.get(identityKey(identity))?.runtime,
    getExecution: (identity) =>
      entries.get(identityKey(identity))?.attachment?.execution
  };
}
