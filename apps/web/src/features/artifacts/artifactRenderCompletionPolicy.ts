export type ArtifactGenerationOutcome = "complete" | "error" | "cancelled";

export type ArtifactMessageStatus = "streaming" | "complete" | "error";

type ArtifactRenderCompletionInput = {
  status?: ArtifactMessageStatus;
  generationOutcome?: ArtifactGenerationOutcome;
  streamUiComplete: boolean;
};

export function shouldCompleteArtifactRender({
  status,
  generationOutcome,
  streamUiComplete
}: ArtifactRenderCompletionInput): boolean {
  return (
    status === "complete" &&
    streamUiComplete &&
    generationOutcome !== "cancelled" &&
    generationOutcome !== "error"
  );
}
