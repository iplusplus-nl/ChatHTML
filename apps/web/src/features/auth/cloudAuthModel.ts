import type {
  AuthSummary,
  AuthUser
} from "../../core/cloudAuth";

export const AUTH_UNAVAILABLE_SUMMARY: AuthSummary = {
  user: null,
  auth: {
    available: false,
    requiresInvite: false,
    firstUser: false
  }
};

export function authSummaryAfterLogoutFailure(
  current: AuthSummary | null
): AuthSummary {
  return current
    ? { ...current, user: null }
    : AUTH_UNAVAILABLE_SUMMARY;
}

export function authSummaryWithUser(
  current: AuthSummary | null,
  user: AuthUser
): AuthSummary {
  return current
    ? { ...current, user }
    : {
        user,
        auth: {
          available: true,
          requiresInvite: false,
          firstUser: false
        }
      };
}
