import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assess } from "../../src/assess.ts";
import { loadContracts } from "../../src/contracts.ts";
import { parseUnifiedDiff } from "../../src/diff.ts";

const contracts = loadContracts();
const enginesRepo = "ignitetech-group/iris-sp-engines";

function assessFixture(relPath: string, repo = enginesRepo) {
  const raw = readFileSync(new URL(`../../${relPath}`, import.meta.url), "utf8");
  return assess({
    repo,
    diff: parseUnifiedDiff(raw),
    source: relPath,
    contracts,
  });
}

describe("contract schema", () => {
  it("loads six approved IRIS contracts", () => {
    assert.equal(contracts.length, 6);
    assert.ok(contracts.every((contract) => contract.status === "approved"));
    assert.deepEqual(
      contracts.map((contract) => contract.id),
      [
        "IRIS-BEH-0001",
        "IRIS-BEH-0002",
        "IRIS-BEH-0003",
        "IRIS-BEH-0004",
        "IRIS-BEH-0005",
        "IRIS-BEH-0006",
      ],
    );
  });
});

describe("positive fixtures must fail", () => {
  const cases: Array<[string, string]> = [
    ["fixtures/positive/remove-dedup-key.diff", "IRIS-BEH-0001"],
    ["fixtures/positive/disable-watermark.diff", "IRIS-BEH-0002"],
    ["fixtures/positive/single-app-secret.diff", "IRIS-BEH-0003"],
    ["fixtures/positive/engine-wide-auth.diff", "IRIS-BEH-0004"],
    ["fixtures/positive/skip-profile-lookup.diff", "IRIS-BEH-0005"],
    ["fixtures/positive/unstable-doc-src-id.diff", "IRIS-BEH-0006"],
  ];

  for (const [file, contractId] of cases) {
    it(`${file} fails ${contractId}`, () => {
      const result = assessFixture(file);
      assert.equal(result.verdict, "fail", JSON.stringify(result.findings, null, 2));
      assert.ok(
        result.findings.some((finding) => finding.contractId === contractId && finding.verdict === "fail"),
        JSON.stringify(result.findings, null, 2),
      );
    });
  }
});

describe("negative fixtures must pass", () => {
  const files = [
    "fixtures/negative/webhook-log-only.diff",
    "fixtures/negative/polling-persist-log.diff",
    "fixtures/negative/page-auth-telemetry.diff",
  ];

  for (const file of files) {
    it(`${file} passes`, () => {
      const result = assessFixture(file);
      assert.equal(result.verdict, "pass", JSON.stringify(result.findings, null, 2));
      assert.ok(result.findings.every((finding) => finding.verdict === "pass"));
    });
  }
});

describe("unmatched diffs are inconclusive", () => {
  it("readme-only.diff is inconclusive", () => {
    const result = assessFixture("fixtures/negative/readme-only.diff");
    assert.equal(result.verdict, "inconclusive");
    assert.equal(result.findings.length, 0);
  });

  it("does not apply engines contracts to an unrelated repo", () => {
    const result = assessFixture("fixtures/positive/remove-dedup-key.diff", "acme/unrelated");
    assert.equal(result.verdict, "inconclusive");
  });

  it("applies sandbox paths inside the personal repo", () => {
    const raw = readFileSync(
      new URL("../../fixtures/positive/remove-dedup-key.diff", import.meta.url),
      "utf8",
    ).replaceAll("engines/facebook/", "fixtures/sandbox/engines/facebook/");
    const result = assess({
      repo: "haleema-ignite/iris-regression-memory",
      diff: parseUnifiedDiff(raw),
      source: "sandbox-positive",
      contracts,
    });
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.contractId === "IRIS-BEH-0001" && finding.verdict === "fail"));
  });
});
