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
  expectedVerdict: "pass" | "fail" | "inconclusive";
  mustFailTruths?: string[];
  mustPassTruths?: string[];
  mustNotFailTruths?: string[];
  legacyContract?: string;
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
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.cases.length, 34);
    assert.equal(new Set(manifest.cases.map((item) => item.id)).size, manifest.cases.length);
  });

  it("keeps the frozen validation cohort explicit", () => {
    const validation = manifest.cases.filter((item) => item.id.startsWith("validation-"));
    assert.equal(validation.length, 12);
    assert.equal(validation.filter((item) => item.category === "same_path_control").length, 3);
    assert.equal(validation.filter((item) => item.expectedVerdict === "inconclusive").length, 3);
    assert.ok(validation.filter((item) => item.expectedVerdict === "inconclusive").every((item) =>
      item.repository === "ignitetech-group/iris-sp-engines",
    ));
  });

  it("does not expect iris-api abstention while leftover 0009 is live", () => {
    const api = manifest.cases.filter((item) => item.repository === "ignitetech-group/iris-api");
    assert.ok(api.length > 0);
    assert.equal(api.filter((item) => item.expectedVerdict === "inconclusive").length, 0);
    assert.equal(manifest.cases.filter((item) => item.id === "fix-tiktok-legacy-860")[0]?.expectedVerdict, "fail");
    assert.equal(manifest.cases.filter((item) => item.id === "fix-listener-legacy-921")[0]?.expectedVerdict, "fail");
    assert.equal(manifest.cases.filter((item) => item.id === "control-meta-oauth-1014")[0]?.expectedVerdict, "pass");
  });

  it("expects PR 1102 to pass, because it modified a wildcard rather than adding one", () => {
    // This case was labelled fail on the belief that it newly adds a
    // leading-wildcard LIKE. Its only LIKE change adds a table alias to a
    // wildcard that already existed, so under reintroduction semantics it must
    // pass. Keeping the old label would pin the false positive in place.
    const case1102 = manifest.cases.find((item) => item.id === "control-care-history-1102");
    assert.equal(case1102?.expectedVerdict, "pass");
    assert.match(case1102?.note ?? "", /already existed/);
  });

  it("states expectations per truth, not just per case", () => {
    // A single `contract` field could not express a fix case, where the case's
    // own truth must PASS while the overall verdict fails on an unrelated
    // ratchet. Every expected-fail case must name at least one truth that has
    // to do something specific.
    for (const item of manifest.cases.filter((entry) => entry.expectedVerdict === "fail")) {
      const named = (item.mustFailTruths?.length ?? 0) + (item.mustPassTruths?.length ?? 0);
      assert.ok(named > 0, `${item.id} names no per-truth expectation`);
    }
    // The 860/921 fix cases are the shape that forced this change.
    for (const id of ["fix-tiktok-legacy-860", "fix-listener-legacy-921"]) {
      const item = manifest.cases.find((entry) => entry.id === id);
      assert.deepEqual(item?.mustFailTruths, ["IRIS-TRUTH-0009"]);
      assert.deepEqual(item?.mustPassTruths, ["IRIS-TRUTH-0005"]);
    }
  });

  it("covers the real Generate Campaign removal and its revert", () => {
    // The flagship product family was fixture-only, which is exactly where a
    // false negative was found. These are real commits in iris-web.
    const removal = manifest.cases.find((item) => item.id === "culprit-generate-campaign-removed");
    assert.equal(removal?.repository, "ignitetech-group/iris-web");
    assert.deepEqual(removal?.mustFailTruths, ["IRIS-TRUTH-0001", "IRIS-TRUTH-0002"]);
    assert.equal(removal?.head, "040a666835b1fa3dbbf451aebfcf5e974bd8a430");

    const revert = manifest.cases.find((item) => item.id === "fix-generate-campaign-restored");
    assert.deepEqual(revert?.mustPassTruths, ["IRIS-TRUTH-0001", "IRIS-TRUTH-0002"]);
    assert.equal(revert?.head, "ae0c40614b00c72619acb12666bd77d4550fc495");
  });

  it("uses immutable commit SHAs and explicit expected outcomes", () => {
    for (const item of manifest.cases) {
      assert.match(item.repository, /^ignitetech-group\/iris-/);
      assert.match(item.localDirectory, /^iris-/);
      // pr may be 0 for a commit pair that was not a pull request.
      assert.ok(Number.isInteger(item.pr) && item.pr >= 0);
      assert.match(item.base, /^[0-9a-f]{40}$/);
      assert.match(item.head, /^[0-9a-f]{40}$/);
      assert.ok(["pass", "fail", "inconclusive"].includes(item.expectedVerdict));
    }
  });
});
