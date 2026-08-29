import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

interface ActionManifest {
  inputs?: Record<string, { required?: boolean }>;
  runs?: { using?: string; main?: string };
}

describe("packaged GitHub Action", () => {
  const root = new URL("../../", import.meta.url);
  const manifest = parseYaml(readFileSync(new URL("action.yml", root), "utf8")) as ActionManifest;

  it("declares the token input and current runtime", () => {
    assert.equal(manifest.inputs?.token?.required, true);
    assert.equal(manifest.runs?.using, "node24");
  });

  it("points to a committed distributable", () => {
    assert.equal(manifest.runs?.main, "dist/action.cjs");
    assert.equal(existsSync(new URL(manifest.runs.main, root)), true);
  });
});
