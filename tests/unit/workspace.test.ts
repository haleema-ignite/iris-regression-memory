import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createFsWorkspace } from "../../src/workspace.ts";

describe("createFsWorkspace", () => {
  it("skips dangling symlinks instead of throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "truth-ws-"));
    try {
      mkdirSync(join(root, ".rulesync"));
      symlinkSync("/this/path/does/not/exist", join(root, ".rulesync", "skills"));
      symlinkSync("/also/missing", join(root, "broken-link"));
      writeFileSync(join(root, "ok.ts"), "export const n = 1;\n");
      const workspace = createFsWorkspace(root);
      assert.deepEqual(workspace.list(["**/*.ts"]), ["ok.ts"]);
      assert.equal(workspace.read("ok.ts"), "export const n = 1;\n");
      assert.equal(workspace.read("broken-link"), undefined);
      assert.equal(workspace.read(".rulesync/skills"), undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
