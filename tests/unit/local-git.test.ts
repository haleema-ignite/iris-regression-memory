import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { detectDefaultBase, localCheckoutDiff } from "../../src/local-git.ts";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "trial",
  GIT_AUTHOR_EMAIL: "trial@example.com",
  GIT_COMMITTER_NAME: "trial",
  GIT_COMMITTER_EMAIL: "trial@example.com",
};

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: gitEnv });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result;
}

describe("local checkout diffs", () => {
  it("diffs the working tree against main without GitHub", () => {
    const root = mkdtempSync(join(tmpdir(), "truth-git-"));
    try {
      git(root, ["init", "-b", "main"]);
      writeFileSync(join(root, "keep.ts"), "export const a = 1;\n");
      git(root, ["add", "keep.ts"]);
      git(root, ["commit", "-m", "base"]);
      writeFileSync(join(root, "keep.ts"), "export const a = 2;\n");
      assert.equal(detectDefaultBase(root), "main");
      const diff = localCheckoutDiff(root);
      assert.match(diff, /export const a = 2/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
