import { actionSource } from "./actionSource";
import { buildCoreSource } from "./coreSource";
import { diagnosticsSource } from "./diagnosticsSource";
import { hostRenderSource } from "./hostRenderSource";
import { measurementSource } from "./measurementSource";
import { selectionSource } from "./selectionSource";

export function buildSandboxRuntimeSource(
  mathJaxScriptSrc: string,
  hostChannelToken = "",
  hostDocumentEpoch = ""
): string {
  return (
    buildCoreSource(mathJaxScriptSrc, hostChannelToken, hostDocumentEpoch) +
    measurementSource +
    selectionSource +
    actionSource +
    hostRenderSource +
    diagnosticsSource
  );
}
