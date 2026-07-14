import type { ArtifactSelection } from "../../core/artifactSelection";
import type { ImageAttachment } from "../../core/imageAttachments";

export type ComposerSubmissionOutcome =
  | "artifact-edit"
  | "artifact-generation"
  | "chat";

export type ComposerSubmissionPorts = {
  getSelections(): ArtifactSelection[];
  runSourceEdit(
    text: string,
    selections: ArtifactSelection[],
    attachments: ImageAttachment[]
  ): Promise<unknown>;
  startArtifactGeneration(
    text: string,
    selections: ArtifactSelection[],
    attachments: ImageAttachment[]
  ): boolean | Promise<boolean>;
  sendChat(text: string, attachments: ImageAttachment[]): Promise<unknown>;
};

/**
 * Routes a composer submission without ever accepting it as a silent no-op.
 * Image-backed artifact edits use the chat generation path, which already
 * supports multimodal input, while ordinary reference edits keep using the
 * smaller source-edit endpoint.
 */
export async function submitComposerMessage(
  text: string,
  attachments: ImageAttachment[],
  ports: ComposerSubmissionPorts
): Promise<ComposerSubmissionOutcome> {
  const selections = ports.getSelections();
  if (selections.length > 0 && attachments.length > 0) {
    if (await ports.startArtifactGeneration(text, selections, attachments)) {
      return "artifact-generation";
    }

    // A stale selection must not consume the composer without producing a
    // request. Fall back to an ordinary multimodal turn instead.
    await ports.sendChat(text, attachments);
    return "chat";
  }

  if (selections.length > 0) {
    await ports.runSourceEdit(text, selections, attachments);
    return "artifact-edit";
  }

  await ports.sendChat(text, attachments);
  return "chat";
}
