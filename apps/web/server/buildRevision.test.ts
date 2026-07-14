import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEPLOYMENT_COMMIT_ENV_NAMES,
  resolveBuildRevision
} from "./buildRevision.js";

describe("build revision resolver", () => {
  it("prefers an explicit Vite revision over deployment metadata and Git", () => {
    assert.equal(
      resolveBuildRevision({
        env: {
          VITE_GIT_COMMIT: " explicit-revision ",
          VERCEL_GIT_COMMIT_SHA: "deployment-revision"
        },
        readGitCommit: () => "git-revision"
      }),
      "explicit-revision"
    );
  });

  it("recognizes common deployment commit variables before Git", () => {
    for (const envName of DEPLOYMENT_COMMIT_ENV_NAMES) {
      assert.equal(
        resolveBuildRevision({
          env: { [envName]: ` ${envName}-revision ` },
          readGitCommit: () => "git-revision"
        }),
        `${envName}-revision`,
        envName
      );
    }
  });

  it("uses the first populated deployment variable in documented order", () => {
    assert.equal(
      resolveBuildRevision({
        env: {
          VERCEL_GIT_COMMIT_SHA: "   ",
          CF_PAGES_COMMIT_SHA: "cloudflare-revision",
          RENDER_GIT_COMMIT: "render-revision"
        },
        readGitCommit: () => "git-revision"
      }),
      "cloudflare-revision"
    );
  });

  it("falls back to the local Git revision when build metadata is absent", () => {
    assert.equal(
      resolveBuildRevision({
        env: {},
        readGitCommit: () => " local-git-revision\n"
      }),
      "local-git-revision"
    );
  });

  it("uses development only after environment and Git resolution fail", () => {
    assert.equal(
      resolveBuildRevision({
        env: {
          VITE_GIT_COMMIT: " ",
          VERCEL_GIT_COMMIT_SHA: ""
        },
        readGitCommit: () => {
          throw new Error("repository metadata unavailable");
        }
      }),
      "development"
    );
  });
});
