import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSummary, AuthUser } from "../../core/cloudAuth";
import {
  AUTH_UNAVAILABLE_SUMMARY,
  authSummaryAfterLogoutFailure,
  authSummaryWithUser
} from "./cloudAuthModel";

const user: AuthUser = {
  id: "user-1",
  email: "user@example.com",
  role: "user"
};

const summary: AuthSummary = {
  user,
  auth: {
    available: true,
    requiresInvite: true,
    firstUser: false
  }
};

describe("cloud auth model", () => {
  it("preserves availability while clearing a user after logout failure", () => {
    const next = authSummaryAfterLogoutFailure(summary);
    assert.deepEqual(next, { ...summary, user: null });
    assert.notEqual(next, summary);
    assert.equal(summary.user, user);
  });

  it("uses the unavailable fallback without an existing summary", () => {
    assert.equal(authSummaryAfterLogoutFailure(null), AUTH_UNAVAILABLE_SUMMARY);
  });

  it("updates a user while preserving availability metadata", () => {
    const updated = { ...user, balanceUsd: "3.50" };
    assert.deepEqual(authSummaryWithUser(summary, updated), {
      ...summary,
      user: updated
    });
  });

  it("creates an available summary for a user received before bootstrap", () => {
    assert.deepEqual(authSummaryWithUser(null, user), {
      user,
      auth: {
        available: true,
        requiresInvite: false,
        firstUser: false
      }
    });
  });
});
