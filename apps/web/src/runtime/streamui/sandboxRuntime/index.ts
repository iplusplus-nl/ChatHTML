import { actionSource } from "./actionSource";
import { buildCoreSource } from "./coreSource";
import { diagnosticsSource } from "./diagnosticsSource";
import { hostRenderSource } from "./hostRenderSource";
import { measurementSource } from "./measurementSource";
import { mediaSource } from "./mediaSource";
import { readabilitySource } from "./readabilitySource";
import { selectionSource } from "./selectionSource";

export function buildSandboxRuntimeSource(
  mathJaxScriptSrc: string,
  hostChannelToken = "",
  hostDocumentEpoch = ""
): string {
  return (
    buildCoreSource(mathJaxScriptSrc, hostChannelToken, hostDocumentEpoch) +
    measurementSource +
    mediaSource +
    selectionSource +
    actionSource +
    readabilitySource +
    hostRenderSource +
    diagnosticsSource
  );
}
