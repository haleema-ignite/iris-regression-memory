import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { assess } from "../../src/assess.ts";
import { filesToUnifiedDiff, parseUnifiedDiff } from "../../src/diff.ts";
import { loadRegistry } from "../../src/registry.ts";
import { createFsWorkspace } from "../../src/workspace.ts";

const registry = loadRegistry("iris");
const enginesRepo = "ignitetech-group/iris-sp-engines";
const apiRepo = "ignitetech-group/iris-api";
const webRepo = "ignitetech-group/iris-web";
const e2eRepo = "ignitetech-group/iris-e2e";

function readRel(relPath: string): string {
  return readFileSync(new URL(`../../${relPath}`, import.meta.url), "utf8");
}

function workspace(relPath: string) {
  return createFsWorkspace(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)));
}

function assessFixture(
  relPath: string,
  repo: string,
  workspaceRel?: string,
) {
  return assess({
    repo,
    diff: parseUnifiedDiff(readRel(relPath)),
    source: relPath,
    registry,
    workspace: workspaceRel ? workspace(workspaceRel) : undefined,
  });
}

describe("IRIS tenant registry", () => {
  it("loads live truths, gaps, and catalogs without IRIS-hardcoded engine code", () => {
    assert.equal(registry.tenant.id, "iris");
    assert.ok(registry.truths.length >= 18);
    assert.ok(registry.truths.some((truth) => truth.status === "gap"));
    assert.ok(registry.surfaces.some((surface) => surface.id === "generate-campaign"));
    assert.equal(new Set(registry.truths.map((truth) => truth.id)).size, registry.truths.length);
  });
});

describe("historical pattern replays still fail the migrated truths", () => {
  const cases: Array<[string, string, string, "pass" | "fail"]> = [
    ["fixtures/positive/remove-dedup-key.diff", enginesRepo, "IRIS-TRUTH-0010", "fail"],
    ["fixtures/positive/disable-watermark.diff", enginesRepo, "IRIS-TRUTH-0007", "fail"],
    ["fixtures/positive/single-app-secret.diff", enginesRepo, "IRIS-TRUTH-0011", "fail"],
    ["fixtures/positive/engine-wide-auth.diff", enginesRepo, "IRIS-TRUTH-0013", "fail"],
    ["fixtures/positive/skip-profile-lookup.diff", enginesRepo, "IRIS-TRUTH-0014", "fail"],
    ["fixtures/positive/unstable-doc-src-id.diff", enginesRepo, "IRIS-TRUTH-0015", "fail"],
    ["fixtures/replay/meta-signature-fix-forward.diff", enginesRepo, "IRIS-TRUTH-0011", "pass"],
    ["fixtures/replay/meta-signature-fix-reverse.diff", enginesRepo, "IRIS-TRUTH-0011", "fail"],
    ["fixtures/replay/instagram-watermark-fix-forward.diff", enginesRepo, "IRIS-TRUTH-0007", "pass"],
    ["fixtures/replay/instagram-watermark-fix-reverse.diff", enginesRepo, "IRIS-TRUTH-0007", "fail"],
    ["fixtures/replay/instagram-watermark-api-culprit.diff", enginesRepo, "IRIS-TRUTH-0007", "fail"],
    ["fixtures/replay/legacy-care-culprit.diff", apiRepo, "IRIS-TRUTH-0005", "fail"],
    ["fixtures/replay/legacy-care-fix.diff", apiRepo, "IRIS-TRUTH-0005", "pass"],
  ];

  for (const [file, repo, truthId, verdict] of cases) {
    it(`${file} is ${verdict} for ${truthId}`, () => {
      const result = assessFixture(file, repo);
      const finding = result.findings.find((item) => item.truthId === truthId);
      assert.equal(finding?.verdict, verdict, JSON.stringify(result.findings, null, 2));
      if (verdict === "fail") assert.equal(result.verdict, "fail");
    });
  }
});

describe("negative neighbors still hold", () => {
  const files = [
    "fixtures/negative/webhook-log-only.diff",
    "fixtures/negative/polling-persist-log.diff",
    "fixtures/negative/page-auth-telemetry.diff",
  ];
  for (const file of files) {
    it(`${file} does not fail`, () => {
      const result = assessFixture(file, enginesRepo);
      assert.equal(result.verdict, "pass", JSON.stringify(result.findings, null, 2));
      assert.ok(result.findings.every((finding) => finding.verdict === "pass"));
    });
  }
});

describe("product truths", () => {
  it("fails when Generate Campaign is gone from the calendar header checkout", () => {
    const result = assessFixture(
      "fixtures/diffs/drop-generate-campaign.diff",
      webRepo,
      "fixtures/workspaces/iris-web-missing",
    );
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0001" && finding.verdict === "fail"));
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0002" && finding.verdict === "fail"));
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0003" && finding.verdict === "fail"));
  });

  it("passes a docs-only iris-web change when the checkout still has Generate Campaign", () => {
    const result = assessFixture(
      "fixtures/diffs/web-readme-only.diff",
      webRepo,
      "fixtures/workspaces/iris-web-ok",
    );
    assert.equal(result.verdict, "pass", JSON.stringify(result.findings, null, 2));
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0001" && finding.verdict === "pass"));
    assert.ok(result.findings.find((finding) => finding.truthId === "IRIS-TRUTH-0001")?.matchReasons.includes("always_on"));
  });

  it("fails a blocking product truth without a checkout", () => {
    const result = assessFixture("fixtures/diffs/web-readme-only.diff", webRepo);
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) =>
      finding.truthId === "IRIS-TRUTH-0001" && finding.evidence.kind === "workspace_required",
    ));
  });

  it("keeps P14 in the iris-e2e catalog", () => {
    const result = assess({
      repo: e2eRepo,
      diff: parseUnifiedDiff(readRel("fixtures/diffs/web-readme-only.diff").replace("iris-web", "iris-e2e")),
      source: "e2e-docs",
      registry,
      workspace: workspace("fixtures/workspaces/iris-e2e-ok"),
    });
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0004" && finding.verdict === "pass"));
  });
});

describe("contract and decision truths", () => {
  it("fails nested int_meta objects", () => {
    const result = assessFixture("fixtures/diffs/nested-int-meta.diff", apiRepo);
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0006" && finding.verdict === "fail"));
  });

  it("fails the exact IRISNG-4090 intMetaOverride.apiParams assignment", () => {
    const result = assessFixture("fixtures/diffs/int-meta-override.diff", apiRepo);
    assert.equal(result.verdict, "fail", JSON.stringify(result.findings, null, 2));
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0006" && finding.verdict === "fail"));
  });

  it("fails integration enumeration that drops int_deleted", () => {
    const result = assessFixture("fixtures/diffs/int-deleted-missing.diff", apiRepo);
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0008" && finding.verdict === "fail"));
  });

  it("passes dynamically composed int_deleted filters", () => {
    const result = assessFixture("fixtures/diffs/int-deleted-dynamic.diff", apiRepo);
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0008");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });

  it("passes historical JOIN int_integration lookups", () => {
    const result = assessFixture("fixtures/diffs/int-deleted-historical-join.diff", apiRepo);
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0008");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });

  it("fails leading-wildcard LIKE against int_meta when it is added", () => {
    const result = assessFixture("fixtures/diffs/like-leading-wildcard.diff", apiRepo);
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0019" && finding.verdict === "fail"));
  });

  it("does not fail a PR that only touches a pre-existing LIKE", () => {
    const result = assessFixture("fixtures/diffs/like-preexisting-context.diff", apiRepo);
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0019");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });

  it("fails a leftover SocialGateway gate even when this PR did not add it", () => {
    const result = assessFixture(
      "fixtures/diffs/unrelated-api-log.diff",
      apiRepo,
      "fixtures/workspaces/iris-api-leftover",
    );
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) =>
      finding.truthId === "IRIS-TRUTH-0009" &&
      finding.verdict === "fail" &&
      finding.evidence.kind === "stale_decision",
    ));
  });

  it("fails hidden-board fail-open", () => {
    const result = assessFixture("fixtures/diffs/hidden-board-fail-open.diff", enginesRepo);
    assert.equal(result.verdict, "fail");
    assert.ok(result.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0012" && finding.verdict === "fail"));
  });

  it("fails a community engine that never had board filtering", () => {
    const result = assessFixture("fixtures/diffs/community-no-board-filter.diff", enginesRepo);
    assert.equal(result.verdict, "fail", JSON.stringify(result.findings, null, 2));
    assert.ok(result.findings.some((finding) =>
      finding.truthId === "IRIS-TRUTH-0012" &&
      finding.verdict === "fail" &&
      finding.evidence.detail.includes("required guard"),
    ));
  });

  it("passes a community log-only change when the checkout still fail-closes hidden boards", () => {
    const result = assessFixture(
      "fixtures/diffs/community-log-only.diff",
      enginesRepo,
      "fixtures/workspaces/community-ok",
    );
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0012");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });
});

describe("matching and coverage", () => {
  it("readme-only engine changes stay inconclusive", () => {
    const result = assessFixture("fixtures/negative/readme-only.diff", enginesRepo);
    assert.equal(result.verdict, "inconclusive");
    assert.ok(result.truthCoverage.gaps.some((gap) => gap.truthId === "IRIS-TRUTH-0016"));
  });

  it("does not apply IRIS truths to an unrelated repo", () => {
    const result = assessFixture("fixtures/positive/remove-dedup-key.diff", "acme/unrelated");
    assert.equal(result.verdict, "inconclusive");
    assert.equal(result.findings.length, 0);
  });

  it("does not call interface-only mentions a pass", () => {
    const raw = `diff --git a/src/unrelated.ts b/src/unrelated.ts
--- a/src/unrelated.ts
+++ b/src/unrelated.ts
@@ -0,0 +1 @@
+export const topic = "facebook.posts.collected";
`;
    const result = assess({ repo: enginesRepo, diff: parseUnifiedDiff(raw), source: "interface-only", registry });
    assert.equal(result.verdict, "inconclusive");
    assert.equal(result.truthsEvaluated, 0);
  });

  it("reports partial file coverage without claiming the whole PR is safe", () => {
    const raw = `${readRel("fixtures/negative/webhook-log-only.diff")}
diff --git a/src/uncovered.ts b/src/uncovered.ts
--- a/src/uncovered.ts
+++ b/src/uncovered.ts
@@ -0,0 +1 @@
+export const changedBehavior = true;
`;
    const result = assess({ repo: enginesRepo, diff: parseUnifiedDiff(raw), source: "partial", registry });
    assert.equal(result.verdict, "pass");
    assert.equal(result.outcome, "selected_truths_hold");
    assert.equal(result.coverage.status, "partial");
    assert.deepEqual(result.coverage.uncoveredFiles, ["src/uncovered.ts"]);
  });

  it("treats a missing GitHub patch as unavailable", () => {
    const raw = filesToUnifiedDiff([{
      filename: "engines/instagram/src/polling/polling.component.ts",
      status: "modified",
      patch: null,
    }]);
    const result = assess({ repo: enginesRepo, diff: parseUnifiedDiff(raw), source: "missing-patch", registry });
    assert.deepEqual(result.coverage.unavailableFiles, [
      "engines/instagram/src/polling/polling.component.ts",
    ]);
  });

  it("does not LLM-judge: CodeRabbit truths are delegated", () => {
    const result = assessFixture(
      "fixtures/diffs/drop-generate-campaign.diff",
      webRepo,
      "fixtures/workspaces/iris-web-ok",
    );
    const delegated = result.findings.find((finding) => finding.truthId === "IRIS-TRUTH-0018");
    assert.equal(delegated?.executor, "coderabbit");
    assert.equal(delegated?.verdict, "pass");
    assert.equal(delegated?.evidence.kind, "delegated");
  });
});
