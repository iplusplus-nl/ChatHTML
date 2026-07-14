import type { ArtifactEditReference } from "../domain/chat/sessionModel";

export const ARTIFACT_EDIT_SELECTION_LABEL = "Selection";

export function getElementReferenceSummary(
  reference: ArtifactEditReference
): string {
  const value = (
    reference.preview ||
    reference.label ||
    reference.tagName ||
    "Element"
  )
    .replace(/\s+/g, " ")
    .trim();

  if (value.length <= 52) {
    return value;
  }

  return `${value.slice(0, 49).trimEnd()}...`;
}
