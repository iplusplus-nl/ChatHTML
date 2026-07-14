export const DEPLOYMENT_COMMIT_ENV_NAMES = [
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
  "RENDER_GIT_COMMIT",
  "RAILWAY_GIT_COMMIT_SHA",
  "COMMIT_REF",
  "GITHUB_SHA",
  "CI_COMMIT_SHA",
  "SOURCE_VERSION",
  "BUILD_SOURCEVERSION",
  "BITBUCKET_COMMIT"
] as const;

type BuildRevisionEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type ResolveBuildRevisionInput = {
  env: BuildRevisionEnvironment;
  readGitCommit(): string | undefined;
};

function normalizeRevision(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function resolveBuildRevision({
  env,
  readGitCommit
}: ResolveBuildRevisionInput): string {
  const explicitRevision = normalizeRevision(env.VITE_GIT_COMMIT);
  if (explicitRevision) {
    return explicitRevision;
  }

  for (const envName of DEPLOYMENT_COMMIT_ENV_NAMES) {
    const deploymentRevision = normalizeRevision(env[envName]);
    if (deploymentRevision) {
      return deploymentRevision;
    }
  }

  try {
    const gitRevision = normalizeRevision(readGitCommit());
    if (gitRevision) {
      return gitRevision;
    }
  } catch {
    // Builds without repository metadata use the final development fallback.
  }

  return "development";
}
