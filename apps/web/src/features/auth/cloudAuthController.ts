import {
  loadAuthSummary,
  logout as logoutAuth,
  type AuthSummary
} from "../../core/cloudAuth";
import {
  AUTH_UNAVAILABLE_SUMMARY,
  authSummaryAfterLogoutFailure
} from "./cloudAuthModel";

export type CloudAuthOutcome = "applied" | "cancelled" | "failed";

export type AuthSummarySetter = (
  value:
    | AuthSummary
    | null
    | ((current: AuthSummary | null) => AuthSummary | null)
) => void;

export type CloudAuthDependencies = {
  loadSummary(): Promise<AuthSummary>;
  logout(): Promise<AuthSummary>;
  warn(message: string, error: unknown): void;
};

const defaultDependencies: CloudAuthDependencies = {
  loadSummary: loadAuthSummary,
  logout: logoutAuth,
  warn: (message, error) => console.warn(message, error)
};

function resolveDependencies(
  overrides?: Partial<CloudAuthDependencies>
): CloudAuthDependencies {
  return { ...defaultDependencies, ...overrides };
}

export async function runInitialCloudAuthLoad(
  input: {
    isCancelled(): boolean;
    setSummary: AuthSummarySetter;
    setLoaded(loaded: boolean): void;
  },
  dependencyOverrides?: Partial<CloudAuthDependencies>
): Promise<CloudAuthOutcome> {
  const dependencies = resolveDependencies(dependencyOverrides);
  try {
    const summary = await dependencies.loadSummary();
    if (input.isCancelled()) {
      return "cancelled";
    }

    input.setSummary(summary);
    input.setLoaded(true);
    return "applied";
  } catch (error) {
    if (input.isCancelled()) {
      return "cancelled";
    }

    dependencies.warn("Could not load ChatHTML Cloud account.", error);
    input.setSummary(AUTH_UNAVAILABLE_SUMMARY);
    input.setLoaded(true);
    return "failed";
  }
}

export async function runCloudAuthRefresh(
  input: {
    cloudEnabled: boolean;
    setSummary: AuthSummarySetter;
    setLoaded(loaded: boolean): void;
  },
  dependencyOverrides?: Partial<CloudAuthDependencies>
): Promise<AuthSummary | null> {
  if (!input.cloudEnabled) {
    input.setSummary(null);
    input.setLoaded(false);
    return null;
  }

  const summary = await resolveDependencies(dependencyOverrides).loadSummary();
  input.setSummary(summary);
  input.setLoaded(true);
  return summary;
}

export async function runCloudAuthLogout(
  input: {
    setSummary: AuthSummarySetter;
    setLoaded(loaded: boolean): void;
    setOverlayOpen(open: boolean): void;
  },
  dependencyOverrides?: Partial<CloudAuthDependencies>
): Promise<CloudAuthOutcome> {
  const dependencies = resolveDependencies(dependencyOverrides);
  try {
    input.setSummary(await dependencies.logout());
    return "applied";
  } catch (error) {
    dependencies.warn("Could not sign out of ChatHTML Cloud.", error);
    input.setSummary((current) => authSummaryAfterLogoutFailure(current));
    return "failed";
  } finally {
    input.setLoaded(true);
    input.setOverlayOpen(false);
  }
}
