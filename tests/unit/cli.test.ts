import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "../../src/cli.ts";

describe("CLI local trial args", () => {
  it("accepts a workspace-only assess without --pr", () => {
    const options = parseArgs([
      "assess",
      "--tenant",
      "iris",
      "--repo",
      "ignitetech-group/iris-web",
      "--workspace",
      "../iris-web",
      "--base",
      "main",
    ]);
    assert.equal(options.command, "assess");
    assert.equal(options.workspace, "../iris-web");
    assert.equal(options.base, "main");
    assert.equal(options.pr, undefined);
    assert.equal(options.diffFile, undefined);
  });

  it("accepts --no-diff for checkout-only product and leftover proofs", () => {
    const options = parseArgs([
      "assess",
      "--repo",
      "ignitetech-group/iris-api",
      "--workspace",
      "../iris-api",
      "--no-diff",
    ]);
    assert.equal(options.noDiff, true);
    assert.equal(options.workspace, "../iris-api");
  });
});
