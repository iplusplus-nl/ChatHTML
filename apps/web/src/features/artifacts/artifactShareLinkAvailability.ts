export const ARTIFACT_SHARE_LINK_ENVIRONMENT_KEY =
  "VITE_CHATHTML_ARTIFACT_SHARE_LINKS";

type ArtifactShareLinkEnvironment = Readonly<Record<string, unknown>>;

export function isArtifactShareLinkAvailable(
  environment: ArtifactShareLinkEnvironment | undefined = import.meta.env
): boolean {
  const value = environment?.[ARTIFACT_SHARE_LINK_ENVIRONMENT_KEY];
  return (
    typeof value === "string" &&
    ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
  );
}

export function filterUnavailableArtifactShareLink<
  T extends { action: string }
>(
  actions: readonly T[],
  environment?: ArtifactShareLinkEnvironment
): T[] {
  if (isArtifactShareLinkAvailable(environment)) {
    return [...actions];
  }

  return actions.filter((item) => item.action !== "create-share-link");
}
