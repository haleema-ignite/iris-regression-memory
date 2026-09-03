import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  detectDefaultBase,
  localCheckoutDiff,
  worktreeStatus,
} from "../../src/local-git.ts";

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0 && !args.includes("--quiet")) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result;
}

function scratchRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "truth-git-"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  return root;
}

describe("local checkout diffs", () => {
  it("diffs the working tree against main without GitHub", () => {
    const root = scratchRepo();
    try {
      writeFileSync(join(root, "keep.ts"), "export const a = 1;\n");
      git(root, ["add", "keep.ts"]);
      git(root, ["commit", "-m", "base"]);
      writeFileSync(join(root, "keep.ts"), "export const a = 2;\n");

      const base = detectDefaultBase(root);
      assert.equal(base.ref, "main");
      assert.match(base.sha, /^[0-9a-f]{40}$/);

      const local = localCheckoutDiff(root);
      assert.match(local.diff, /export const a = 2/);
      assert.equal(local.base.ref, "main");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefers a remote-tracking base over a local branch of the same name", () => {
    // A local `main` is whatever was last pulled. All four IRIS checkouts have
    // a local `main` that differs from origin/main, so preferring it made the
    // same branch assess differently on different machines.
    const origin = scratchRepo();
    try {
      writeFileSync(join(origin, "keep.ts"), "export const a = 1;\n");
      git(origin, ["add", "keep.ts"]);
      git(origin, ["commit", "-m", "shared base"]);

      const clone = mkdtempSync(join(tmpdir(), "truth-git-clone-"));
      try {
        spawnSync("git", ["clone", "-q", origin, clone], { encoding: "utf8" });
        git(clone, ["config", "user.email", "test@example.com"]);
        git(clone, ["config", "user.name", "Test"]);
        // Move local main ahead so it differs from origin/main.
        writeFileSync(join(clone, "keep.ts"), "export const a = 99;\n");
        git(clone, ["commit", "-am", "local only"]);

        const base = detectDefaultBase(clone);
        assert.equal(base.ref, "origin/main", "must not silently pick the local branch");
        assert.equal(base.local, false);
      } finally {
        rmSync(clone, { recursive: true, force: true });
      }
    } finally {
      rmSync(origin, { recursive: true, force: true });
    }
  });

  it("diffs from the merge base, not the base tip", () => {
    // Diffing against the tip attributes every commit that landed on the base
    // after the branch started to this branch.
    const root = scratchRepo();
    try {
      writeFileSync(join(root, "keep.ts"), "export const a = 1;\n");
      git(root, ["add", "keep.ts"]);
      git(root, ["commit", "-m", "shared base"]);

      git(root, ["checkout", "-q", "-b", "feature"]);
      writeFileSync(join(root, "mine.ts"), "export const mine = true;\n");
      git(root, ["add", "mine.ts"]);
      git(root, ["commit", "-m", "my work"]);

      // Someone else advances main after the branch point.
      git(root, ["checkout", "-q", "main"]);
      writeFileSync(join(root, "theirs.ts"), "export const theirs = true;\n");
      git(root, ["add", "theirs.ts"]);
      git(root, ["commit", "-m", "their work"]);
      git(root, ["checkout", "-q", "feature"]);

      const local = localCheckoutDiff(root, { base: "main" });
      assert.match(local.diff, /mine\.ts/, "my work must be in the diff");
      assert.doesNotMatch(local.diff, /theirs\.ts/, "their work must not be attributed to me");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes untracked files rather than silently ignoring them", () => {
    // A runner that says it assesses uncommitted work and then skips new files
    // is claiming coverage it does not have, and a brand-new file is exactly
    // where a fresh violation lives.
    const root = scratchRepo();
    try {
      writeFileSync(join(root, "keep.ts"), "export const a = 1;\n");
      git(root, ["add", "keep.ts"]);
      git(root, ["commit", "-m", "base"]);
      writeFileSync(join(root, "brand-new.ts"), "export const sneaky = \"LIKE '%x%'\";\n");

      const status = worktreeStatus(root);
      assert.deepEqual(status.untracked, ["brand-new.ts"]);

      const withUntracked = localCheckoutDiff(root, { includeUntracked: true });
      assert.match(withUntracked.diff, /brand-new\.ts/);
      assert.deepEqual(withUntracked.untrackedIncluded, ["brand-new.ts"]);

      const without = localCheckoutDiff(root, { includeUntracked: false });
      assert.doesNotMatch(without.diff, /brand-new\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("counts modified and untracked files separately", () => {
    const root = scratchRepo();
    try {
      writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
      git(root, ["add", "a.ts"]);
      git(root, ["commit", "-m", "base"]);
      writeFileSync(join(root, "a.ts"), "export const a = 2;\n");
      writeFileSync(join(root, "b.ts"), "export const b = 1;\n");

      const status = worktreeStatus(root);
      assert.equal(status.modified, 1);
      assert.deepEqual(status.untracked, ["b.ts"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
