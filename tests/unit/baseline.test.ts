import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkoutSha, materializeBaseline, resolveRef } from "../../src/baseline.ts";

// This repository is itself a git checkout, so it is a deterministic subject.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("base state materialization", () => {
  it("reports the checkout's own commit", () => {
    const sha = checkoutSha(repoRoot);
    assert.match(sha ?? "", /^[0-9a-f]{40}$/);
  });

  it("resolves a ref that exists and refuses one that does not", () => {
    assert.match(resolveRef(repoRoot, "HEAD") ?? "", /^[0-9a-f]{40}$/);
    assert.equal(resolveRef(repoRoot, "refs/heads/definitely-not-a-branch"), undefined);
  });

  it("materializes a ref into a readable tree and cleans up after itself", () => {
    // Attribution depends on this: a pull request base that is present in the
    // checkout must be readable as a workspace, so a workspace failure can be
    // classified instead of reported as unknown.
    const baseline = materializeBaseline(repoRoot, "HEAD");
    try {
      assert.match(baseline.sha, /^[0-9a-f]{40}$/);
      assert.ok(
        (baseline.workspace.read("package.json") ?? "").includes("truth-compiler"),
        "the materialized tree must be readable",
      );
    } finally {
      baseline.dispose();
    }
    assert.equal(baseline.workspace.read("package.json"), undefined, "dispose must remove the tree");
  });

  it("refuses a ref it cannot resolve, with an actionable message", () => {
    assert.throws(
      () => materializeBaseline(repoRoot, "refs/heads/definitely-not-a-branch"),
      /could not be resolved/,
    );
  });
});
