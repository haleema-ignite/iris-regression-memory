import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parse as parseYaml } from "yaml";

interface ActionManifest {
  inputs?: Record<string, { required?: boolean; default?: string }>;
  runs?: { using?: string; main?: string };
}

describe("packaged GitHub Action", () => {
  const root = new URL("../../", import.meta.url);
  const manifest = parseYaml(readFileSync(new URL("action.yml", root), "utf8")) as ActionManifest;

  it("defaults to blocking error mode with a tenant input", () => {
    assert.equal(manifest.inputs?.token?.required, true);
    assert.equal(manifest.inputs?.tenant?.default, "iris");
    assert.equal(manifest.inputs?.enforcement?.default, "error");
    assert.equal(manifest.runs?.using, "node24");
  });

  it("points to a committed distributable", () => {
    assert.equal(manifest.runs?.main, "dist/action.cjs");
  });
});
