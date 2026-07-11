import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthSummary } from "../../core/cloudAuth";
import {
  runCloudAuthLogout,
  runCloudAuthRefresh,
  runInitialCloudAuthLoad,
  type AuthSummarySetter,
  type CloudAuthDependencies
} from "./cloudAuthController";
import { AUTH_UNAVAILABLE_SUMMARY } from "./cloudAuthModel";

const signedIn: AuthSummary = {
  user: {
    id: "user-1",
    email: "user@example.com",
    role: "user"
  },
  auth: {
    available: true,
    requiresInvite: false,
    firstUser: false
  }
};

const signedOut: AuthSummary = {
  ...signedIn,
  user: null
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function statePort(initial: AuthSummary | null = null) {
  let summary = initial;
  let loaded = false;
  let overlayOpen = true;
  const setSummary: AuthSummarySetter = (value) => {
    summary = typeof value === "function" ? value(summary) : value;
  };
  return {
    setSummary,
    setLoaded: (value: boolean) => {
      loaded = value;
    },
    setOverlayOpen: (value: boolean) => {
      overlayOpen = value;
    },
    read: () => ({ summary, loaded, overlayOpen })
  };
}

function dependencies(
  overrides: Partial<CloudAuthDependencies>
): Partial<CloudAuthDependencies> {
  return { warn: () => undefined, ...overrides };
}

describe("cloud auth controller", () => {
  it("applies an initial account summary", async () => {
    const port = statePort();
    assert.equal(
      await runInitialCloudAuthLoad(
        {
          isCancelled: () => false,
          setSummary: port.setSummary,
          setLoaded: port.setLoaded
        },
        dependencies({ loadSummary: async () => signedIn })
      ),
      "applied"
    );
    assert.deepEqual(port.read(), {
      summary: signedIn,
      loaded: true,
      overlayOpen: true
    });
  });

  it("uses an unavailable summary and warns on initial failure", async () => {
    const port = statePort();
    const failure = new Error("load failed");
    const warnings: Array<[string, unknown]> = [];

    assert.equal(
      await runInitialCloudAuthLoad(
        {
          isCancelled: () => false,
          setSummary: port.setSummary,
          setLoaded: port.setLoaded
        },
        dependencies({
          loadSummary: async () => {
            throw failure;
          },
          warn: (message, error) => warnings.push([message, error])
        })
      ),
      "failed"
    );
    assert.equal(port.read().summary, AUTH_UNAVAILABLE_SUMMARY);
    assert.equal(port.read().loaded, true);
    assert.deepEqual(warnings, [
      ["Could not load ChatHTML Cloud account.", failure]
    ]);
  });

  it("suppresses cancelled initial success and failure results", async () => {
    const success = deferred<AuthSummary>();
    const failure = deferred<AuthSummary>();
    const port = statePort();
    let cancelled = false;
    let warnings = 0;
    const input = {
      isCancelled: () => cancelled,
      setSummary: port.setSummary,
      setLoaded: port.setLoaded
    };
    const successLoad = runInitialCloudAuthLoad(
      input,
      dependencies({ loadSummary: () => success.promise })
    );
    const failureLoad = runInitialCloudAuthLoad(
      input,
      dependencies({
        loadSummary: () => failure.promise,
        warn: () => {
          warnings += 1;
        }
      })
    );

    cancelled = true;
    success.resolve(signedIn);
    failure.reject(new Error("cancelled failure"));

    assert.deepEqual(await Promise.all([successLoad, failureLoad]), [
      "cancelled",
      "cancelled"
    ]);
    assert.deepEqual(port.read().summary, null);
    assert.equal(port.read().loaded, false);
    assert.equal(warnings, 0);
  });

  it("resets refresh state while cloud is disabled", async () => {
    const port = statePort(signedIn);
    let requests = 0;
    assert.equal(
      await runCloudAuthRefresh(
        {
          cloudEnabled: false,
          setSummary: port.setSummary,
          setLoaded: port.setLoaded
        },
        dependencies({
          loadSummary: async () => {
            requests += 1;
            return signedIn;
          }
        })
      ),
      null
    );
    assert.equal(requests, 0);
    assert.equal(port.read().summary, null);
    assert.equal(port.read().loaded, false);
  });

  it("refreshes and returns the account summary", async () => {
    const port = statePort();
    assert.equal(
      await runCloudAuthRefresh(
        {
          cloudEnabled: true,
          setSummary: port.setSummary,
          setLoaded: port.setLoaded
        },
        dependencies({ loadSummary: async () => signedIn })
      ),
      signedIn
    );
    assert.equal(port.read().summary, signedIn);
    assert.equal(port.read().loaded, true);
  });

  it("propagates refresh failures without changing state", async () => {
    const port = statePort(signedOut);
    const failure = new Error("refresh failed");
    await assert.rejects(
      runCloudAuthRefresh(
        {
          cloudEnabled: true,
          setSummary: port.setSummary,
          setLoaded: port.setLoaded
        },
        dependencies({
          loadSummary: async () => {
            throw failure;
          }
        })
      ),
      failure
    );
    assert.equal(port.read().summary, signedOut);
    assert.equal(port.read().loaded, false);
  });

  it("applies logout success and always closes the overlay", async () => {
    const port = statePort(signedIn);
    assert.equal(
      await runCloudAuthLogout(
        {
          setSummary: port.setSummary,
          setLoaded: port.setLoaded,
          setOverlayOpen: port.setOverlayOpen
        },
        dependencies({ logout: async () => signedOut })
      ),
      "applied"
    );
    assert.deepEqual(port.read(), {
      summary: signedOut,
      loaded: true,
      overlayOpen: false
    });
  });

  it("clears the local user and warns when logout fails", async () => {
    const port = statePort(signedIn);
    const failure = new Error("logout failed");
    const warnings: Array<[string, unknown]> = [];
    assert.equal(
      await runCloudAuthLogout(
        {
          setSummary: port.setSummary,
          setLoaded: port.setLoaded,
          setOverlayOpen: port.setOverlayOpen
        },
        dependencies({
          logout: async () => {
            throw failure;
          },
          warn: (message, error) => warnings.push([message, error])
        })
      ),
      "failed"
    );
    assert.equal(port.read().summary?.user, null);
    assert.deepEqual(port.read().summary?.auth, signedIn.auth);
    assert.equal(port.read().loaded, true);
    assert.equal(port.read().overlayOpen, false);
    assert.deepEqual(warnings, [
      ["Could not sign out of ChatHTML Cloud.", failure]
    ]);
  });
});
