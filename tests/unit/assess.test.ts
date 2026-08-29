import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assess } from "../../src/assess.ts";
import { loadContracts } from "../../src/contracts.ts";
import { filesToUnifiedDiff, parseUnifiedDiff } from "../../src/diff.ts";

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
  it("loads seven approved IRIS contracts", () => {
    assert.equal(contracts.length, 7);
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
        "IRIS-BEH-0007",
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

  it("does not call a reviewed contract an applicable pass", () => {
    const reviewed = contracts.map((contract) => ({ ...contract, status: "reviewed" as const }));
    const raw = readFileSync(
      new URL("../../fixtures/negative/webhook-log-only.diff", import.meta.url),
      "utf8",
    );
    const result = assess({ repo: enginesRepo, diff: parseUnifiedDiff(raw), source: "reviewed-only", contracts: reviewed });
    assert.equal(result.verdict, "inconclusive");
    assert.equal(result.contractsEvaluated, 0);
  });

  it("does not call an interface-only retrieval hit a pass", () => {
    const raw = `diff --git a/src/unrelated.ts b/src/unrelated.ts
--- a/src/unrelated.ts
+++ b/src/unrelated.ts
@@ -0,0 +1 @@
+export const topic = "facebook.posts.collected";
`;
    const result = assess({ repo: enginesRepo, diff: parseUnifiedDiff(raw), source: "interface-only", contracts });
    assert.equal(result.verdict, "inconclusive");
    assert.equal(result.contractsEvaluated, 0);
    assert.deepEqual(result.retrieved, ["IRIS-BEH-0001"]);
  });

  it("applies sandbox paths when assessed as the target repository", () => {
    const raw = readFileSync(
      new URL("../../fixtures/positive/remove-dedup-key.diff", import.meta.url),
      "utf8",
    ).replaceAll("engines/facebook/", "fixtures/sandbox/engines/facebook/");
    const result = assess({
      repo: enginesRepo,
      diff: parseUnifiedDiff(raw),
      source: "sandbox-positive",
      contracts,
    });
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.contractId === "IRIS-BEH-0001" && finding.verdict === "fail"));
  });
});

describe("sanitized historical replay", () => {
  const cases: Array<[string, string, "pass" | "fail"]> = [
    ["fixtures/replay/meta-signature-fix-forward.diff", "IRIS-BEH-0003", "pass"],
    ["fixtures/replay/meta-signature-fix-reverse.diff", "IRIS-BEH-0003", "fail"],
    ["fixtures/replay/instagram-watermark-fix-forward.diff", "IRIS-BEH-0002", "pass"],
    ["fixtures/replay/instagram-watermark-fix-reverse.diff", "IRIS-BEH-0002", "fail"],
    ["fixtures/replay/instagram-watermark-api-culprit.diff", "IRIS-BEH-0002", "fail"],
    ["fixtures/replay/legacy-care-culprit.diff", "IRIS-BEH-0007", "fail"],
    ["fixtures/replay/legacy-care-fix.diff", "IRIS-BEH-0007", "pass"],
  ];

  for (const [file, contractId, verdict] of cases) {
    it(`${file} produces ${verdict} for ${contractId}`, () => {
      const repo = contractId === "IRIS-BEH-0007" ? "ignitetech-group/iris-api" : enginesRepo;
      const result = assessFixture(file, repo);
      const finding = result.findings.find((item) => item.contractId === contractId);
      assert.equal(finding?.verdict, verdict, JSON.stringify(result, null, 2));
      if (verdict === "fail") assert.equal(result.verdict, "fail");
    });
  }

  it("does not mask the isolated watermark replay with an unrelated profile contract", () => {
    const result = assessFixture("fixtures/replay/instagram-watermark-fix-reverse.diff");
    assert.equal(result.verdict, "fail");
    assert.equal(
      result.findings.find((item) => item.contractId === "IRIS-BEH-0005")?.verdict,
      undefined,
    );
  });
});

describe("coverage", () => {
  it("reports partial coverage without claiming the whole PR is safe", () => {
    const raw = `${readFileSync(new URL("../../fixtures/negative/webhook-log-only.diff", import.meta.url), "utf8")}
diff --git a/src/uncovered.ts b/src/uncovered.ts
--- a/src/uncovered.ts
+++ b/src/uncovered.ts
@@ -0,0 +1 @@
+export const changedBehavior = true;
`;
    const result = assess({ repo: enginesRepo, diff: parseUnifiedDiff(raw), source: "partial", contracts });
    assert.equal(result.verdict, "pass");
    assert.equal(result.outcome, "no_known_regression");
    assert.equal(result.coverage.status, "partial");
    assert.deepEqual(result.coverage.uncoveredFiles, ["src/uncovered.ts"]);
  });

  it("treats a missing GitHub patch as unavailable and inconclusive", () => {
    const raw = filesToUnifiedDiff([{
      filename: "engines/instagram/src/polling/polling.component.ts",
      status: "modified",
      patch: null,
    }]);
    const result = assess({ repo: enginesRepo, diff: parseUnifiedDiff(raw), source: "missing-patch", contracts });
    assert.equal(result.verdict, "inconclusive");
    assert.equal(result.contractsEvaluated, 0);
    assert.deepEqual(result.coverage.unavailableFiles, [
      "engines/instagram/src/polling/polling.component.ts",
    ]);
    assert.equal(result.coverage.status, "none");
  });
});
