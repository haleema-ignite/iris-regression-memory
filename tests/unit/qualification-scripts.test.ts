import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runScript(script: string, args: string[]) {
  return spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("release qualification scripts", () => {
  it("fails the canonical probe when required checkouts are missing", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "truth-empty-iris-"));
    try {
      const result = runScript("canonical-probe.mjs", ["--iris-root", emptyRoot]);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /not present — REQUIRED/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("allows an explicitly partial canonical probe", () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), "truth-empty-iris-"));
    try {
      const result = runScript("canonical-probe.mjs", [
        "--iris-root",
        emptyRoot,
        "--allow-missing",
      ]);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /not present, skipped/);
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("fails strict Semgrep qualification when the executable is unavailable", () => {
    const result = runScript("verify-semgrep.mjs", [
      "--required",
      "--semgrep-bin",
      join(tmpdir(), "truth-semgrep-does-not-exist"),
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Strict mode was requested, so this run fails/);
  });
});
