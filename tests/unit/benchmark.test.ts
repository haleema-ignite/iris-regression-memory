import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface BenchmarkCase {
  id: string;
  category?: string;
  repository: string;
  localDirectory: string;
  pr: number;
  base: string;
  head: string;
  expected: "pass" | "fail" | "inconclusive";
  note?: string;
}

interface BenchmarkManifest {
  schemaVersion: number;
  cases: BenchmarkCase[];
  expectationsNote?: string;
}

const manifest = JSON.parse(readFileSync(
  new URL("../../benchmarks/iris-historical.json", import.meta.url),
  "utf8",
)) as BenchmarkManifest;

describe("historical benchmark manifest", () => {
  it("has stable unique case identifiers", () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.cases.length, 32);
    assert.equal(new Set(manifest.cases.map((item) => item.id)).size, manifest.cases.length);
  });

  it("keeps the frozen validation cohort explicit", () => {
    const validation = manifest.cases.filter((item) => item.id.startsWith("validation-"));
    assert.equal(validation.length, 12);
    assert.equal(validation.filter((item) => item.category === "same_path_control").length, 3);
    assert.equal(validation.filter((item) => item.expected === "inconclusive").length, 3);
    assert.ok(validation.filter((item) => item.expected === "inconclusive").every((item) =>
      item.repository === "ignitetech-group/iris-sp-engines",
    ));
  });

  it("does not expect iris-api abstention while leftover 0009 is live", () => {
    const api = manifest.cases.filter((item) => item.repository === "ignitetech-group/iris-api");
    assert.ok(api.length > 0);
    assert.equal(api.filter((item) => item.expected === "inconclusive").length, 0);
    assert.equal(manifest.cases.filter((item) => item.id === "fix-tiktok-legacy-860")[0]?.expected, "fail");
    assert.equal(manifest.cases.filter((item) => item.id === "fix-listener-legacy-921")[0]?.expected, "fail");
    assert.equal(manifest.cases.filter((item) => item.id === "control-care-history-1102")[0]?.expected, "fail");
    assert.equal(manifest.cases.filter((item) => item.id === "control-meta-oauth-1014")[0]?.expected, "pass");
  });

  it("uses immutable commit SHAs and explicit expected outcomes", () => {
    for (const item of manifest.cases) {
      assert.match(item.repository, /^ignitetech-group\/iris-/);
      assert.match(item.localDirectory, /^iris-/);
      assert.ok(Number.isInteger(item.pr) && item.pr > 0);
      assert.match(item.base, /^[0-9a-f]{40}$/);
      assert.match(item.head, /^[0-9a-f]{40}$/);
      assert.ok(["pass", "fail", "inconclusive"].includes(item.expected));
    }
  });
});
