export type AssistantMessageNavigationKind =
  | "artifact-versions"
  | "response-branches";

export function getAssistantMessageNavigationKinds(
  hasArtifactVersions: boolean,
  hasResponseBranches: boolean
): AssistantMessageNavigationKind[] {
  return [
    ...(hasArtifactVersions ? (["artifact-versions"] as const) : []),
    ...(hasResponseBranches ? (["response-branches"] as const) : [])
  ];
}
