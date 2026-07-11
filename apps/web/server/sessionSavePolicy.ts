import {
  normalizeSessionSaveClientId,
  normalizeSessionSaveRevision,
  recordSessionSaveRevision,
  shouldApplySessionSaveRevision
} from "./sessionSaveRevision.js";
import { mergeClientSaveState } from "./sessionStateMerge.js";
import type { StoredSessionState } from "./sessionStateTypes.js";

export type ClientSessionSaveResolution = {
  applied: boolean;
  clientId: string;
  saveRevision: number | undefined;
  currentSaveRevision: number | undefined;
  state: StoredSessionState;
};

export function resolveClientSessionSave({
  current,
  incoming,
  deletedSessionIds,
  clientId: rawClientId,
  saveRevision: rawSaveRevision
}: {
  current: StoredSessionState;
  incoming: StoredSessionState;
  deletedSessionIds?: Set<string>;
  clientId: unknown;
  saveRevision: unknown;
}): ClientSessionSaveResolution {
  const clientId = normalizeSessionSaveClientId(rawClientId);
  const saveRevision = normalizeSessionSaveRevision(rawSaveRevision);
  const currentSaveRevision = clientId
    ? current.clientSaveRevisions?.[clientId]
    : undefined;
  if (!shouldApplySessionSaveRevision(current, clientId, saveRevision)) {
    return {
      applied: false,
      clientId,
      saveRevision,
      currentSaveRevision,
      state: current
    };
  }

  const merged = mergeClientSaveState(
    current,
    incoming,
    deletedSessionIds
  );
  return {
    applied: true,
    clientId,
    saveRevision,
    currentSaveRevision: saveRevision ?? currentSaveRevision,
    state: recordSessionSaveRevision(merged, clientId, saveRevision)
  };
}
