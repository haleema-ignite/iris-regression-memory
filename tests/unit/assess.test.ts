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

  it("refuses to adjudicate a product truth without a checkout", () => {
    // Previously this returned `fail` with kind `workspace_required`, which
    // reported a missing checkout as a failed product fact. A diff cannot prove
    // a surface exists — the file reconstructed from hunk context is not the
    // file — so the executor refuses.
    //
    // The refusal surfaces as an `error` verdict, not a failed fact: a truth
    // that could not run has proved nothing in either direction, and calling it
    // a failure invites someone to "fix" a configuration problem by editing
    // product code. One unevaluable truth must not discard the rest of the run.
    const result = assessFixture("fixtures/diffs/web-readme-only.diff", webRepo);
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0001");
    assert.equal(finding?.verdict, "error");
    assert.equal(finding?.proofScope, "not_evaluated");
    assert.equal(finding?.blocking, false);
    assert.equal(result.truthCoverage.failed, 0, "an unevaluable truth is not a failed fact");
    assert.match(finding?.evidence.detail ?? "", /executor error/);
    assert.match(finding?.reason ?? "", /cannot be adjudicated without a checkout/);
    // Every other selected truth was still evaluated.
    assert.ok(result.findings.length > 1, "other truths must still be assessed");
  });

  it("detects the control being deleted when comments still name it", () => {
    // The regression that motivated IRIS-TRUTH-0001 left
    // `{/* Generate Campaign Button */}` and the `onGenerateCampaign` prop
    // behind. A substring check passed on that. Requiring the label as JSX text,
    // matched outside comments, is what makes this detectable.
    const result = assess({
      repo: webRepo,
      diff: parseUnifiedDiff(readRel("fixtures/diffs/drop-generate-campaign.diff")),
      source: "comment-ghost",
      registry,
      workspace: workspace("fixtures/workspaces/iris-web-comment-ghost"),
      // The control was there before this change, so failing now is on this change.
      baseWorkspace: workspace("fixtures/workspaces/iris-web-ok"),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0001");
    assert.equal(finding?.verdict, "fail", JSON.stringify(result.findings, null, 2));
    assert.equal(finding?.failureClass, "introduced");
    assert.match(finding?.evidence.detail ?? "", /Generate Campaign/);
    assert.equal(result.outcome, "fact_failed");
    // The healthy page and promotion grep in this workspace must still pass, so
    // the failure is attributed to the header alone.
    assert.equal(result.findings.find((item) => item.truthId === "IRIS-TRUTH-0002")?.verdict, "pass");
    assert.equal(result.findings.find((item) => item.truthId === "IRIS-TRUTH-0003")?.verdict, "pass");
  });

  it("detects the panel being deleted when a JSX comment still names it", () => {
    // The same ghost as IRIS-TRUTH-0001, one level up: the panel is gone from
    // PublisherCalendarPage but `{/* <GenerateCampaignPanel ... /> */}` remains.
    const result = assess({
      repo: webRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/features/publishing/calendar/PublisherCalendarPage.tsx b/src/features/publishing/calendar/PublisherCalendarPage.tsx",
        "--- a/src/features/publishing/calendar/PublisherCalendarPage.tsx",
        "+++ b/src/features/publishing/calendar/PublisherCalendarPage.tsx",
        "@@ -1,2 +1,2 @@",
        "-      <GenerateCampaignPanel onGenerateCampaign={h} />",
        "+      </div>{/* <GenerateCampaignPanel onGenerateCampaign={h} /> */}",
      ].join("\n")),
      source: "jsx-ghost",
      registry,
      workspace: {
        root: "/memory",
        read: (path: string) => ({
          "src/features/publishing/calendar/PublisherCalendarPage.tsx":
            "export function Page() {\n  return (\n    <section>\n      </div>{/* <GenerateCampaignPanel onGenerateCampaign={h} /> */}\n    </section>\n  );\n}",
          "src/features/publishing/calendar/components/PublisherCalendarHeader.tsx":
            "export function Header({ onGenerateCampaign }) {\n  return <button onClick={onGenerateCampaign}>Generate Campaign</button>;\n}",
          ".github/workflows/qa001-deploy.yaml": "test_grep: \"P14|Generate Campaign\"",
        })[path],
        list: () => [],
      },
    });
    assert.equal(result.findings.find((item) => item.truthId === "IRIS-TRUTH-0002")?.verdict, "fail");
    // The header is genuinely intact, so 0001 must not be dragged down with it.
    assert.equal(result.findings.find((item) => item.truthId === "IRIS-TRUTH-0001")?.verdict, "pass");
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

  it("adjudicates community board visibility against the real guard tokens", () => {
    // 0012 is live and names the tokens the IRISNG-3231 fix actually uses:
    // resolveBoardVisibility, cfg.includeHidden and the 'unknown-board' drop.
    // All three are present on origin/main and origin/develop.
    const guarded = [
      "const board = boardsMap.get(boardId);",
      "if (!boardsMap.has(boardId)) return { keep: false, reason: 'unknown-board' };",
      "if (board?.hidden === true && !cfg.includeHidden) return { keep: false, reason: 'hidden' };",
      "await rt.client.resolveBoardVisibility(id);",
    ].join("\n");
    const holds = assess({
      repo: enginesRepo,
      diff: parseUnifiedDiff(readRel("fixtures/diffs/community-no-board-filter.diff")),
      source: "community-guarded",
      registry,
      workspace: {
        root: "/memory",
        read: (path: string) =>
          path === "engines/community/src/polling/filtering.ts" ? guarded : undefined,
        list: () => ["engines/community/src/polling/filtering.ts"],
      },
    });
    assert.equal(holds.findings.find((item) => item.truthId === "IRIS-TRUTH-0012")?.verdict, "pass");

    // A checkout that predates the fix fails it.
    const missing = assess({
      repo: enginesRepo,
      diff: parseUnifiedDiff(readRel("fixtures/diffs/community-no-board-filter.diff")),
      source: "community-unguarded",
      registry,
      workspace: {
        root: "/memory",
        read: (path: string) =>
          path === "engines/community/src/polling/filtering.ts" ? "export const poll = 1;" : undefined,
        list: () => ["engines/community/src/polling/filtering.ts"],
      },
    });
    assert.equal(missing.findings.find((item) => item.truthId === "IRIS-TRUTH-0012")?.verdict, "fail");
  });

  it("proves leftover and product facts from a checkout with no diff", () => {
    const leftover = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff(""),
      source: "workspace-only",
      registry,
      workspace: workspace("fixtures/workspaces/iris-api-leftover"),
    });
    assert.equal(leftover.verdict, "fail");
    assert.ok(leftover.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0009" && finding.verdict === "fail"));

    const product = assess({
      repo: webRepo,
      diff: parseUnifiedDiff(""),
      source: "workspace-only",
      registry,
      workspace: workspace("fixtures/workspaces/iris-web-ok"),
    });
    assert.ok(product.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0001" && finding.verdict === "pass"));
    assert.ok(product.findings.some((finding) => finding.truthId === "IRIS-TRUTH-0003" && finding.verdict === "pass"));
  });

  it("does not claim a board-visibility failure it cannot see from a diff", () => {
    // Retargeted. The old assertion relied on prose signals matching added
    // lines. 0012 now requires three real tokens to be *present* in the
    // checkout, and absence cannot be established from a diff — the guards may
    // simply live outside it. So without a workspace this must not fail, and
    // the checkout-based case above is what proves the guard.
    const result = assessFixture("fixtures/diffs/hidden-board-fail-open.diff", enginesRepo);
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0012");
    assert.notEqual(finding?.verdict, "fail", "must not invent a failure without evidence");
  });

  it("keeps demoted truths visible as gaps rather than dropping them", () => {
    const result = assessFixture("fixtures/negative/readme-only.diff", enginesRepo);
    const gapIds = result.truthCoverage.gaps.map((gap) => gap.truthId);
    // 0012 and 0015 were demoted because their checks could not hold against the
    // real repositories; 0020-0022 are new proposals. None may silently vanish.
    // Engine-scoped unfinished coverage: 0015 and 0016 are gaps, 0020 and 0021
    // are proposals awaiting an owner's decision. None may silently vanish.
    for (const id of ["IRIS-TRUTH-0015", "IRIS-TRUTH-0016", "IRIS-TRUTH-0020", "IRIS-TRUTH-0021"]) {
      assert.ok(gapIds.includes(id), `${id} must stay visible as a gap`);
    }
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

  it("does not LLM-judge: CodeRabbit truths are delegated, not passed", () => {
    const result = assessFixture(
      "fixtures/diffs/drop-generate-campaign.diff",
      webRepo,
      "fixtures/workspaces/iris-web-ok",
    );
    const delegated = result.findings.find((finding) => finding.truthId === "IRIS-TRUTH-0018");
    assert.equal(delegated?.executor, "coderabbit");
    // A hand-off verified nothing, so it must not be counted as a pass.
    assert.equal(delegated?.verdict, "delegated");
    assert.equal(delegated?.evidence.kind, "delegated");
    assert.ok(
      !result.findings.some((finding) =>
        finding.truthId === "IRIS-TRUTH-0018" && finding.verdict === "pass",
      ),
    );
    assert.equal(result.truthCoverage.delegated, 1);
  });
});
