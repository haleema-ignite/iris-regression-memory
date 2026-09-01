import { runExecutor } from "./executors/index.ts";
import { isLive, isVisibleGap, pathInScope, selectTruths } from "./match.ts";
import { stripSandboxPrefix } from "./diff.ts";
import { createDiffWorkspace, overlayWorkspace } from "./workspace.ts";
import { repoMatches } from "./glob.ts";
import type {
  AssessInput,
  Assessment,
  AssessmentCoverage,
  AssessmentOutcome,
  Finding,
  GapRecord,
  TruthCoverage,
  Verdict,
} from "./types.ts";

const COVERAGE_EXCLUDES = [
  /^docs\//,
  /^\.github\//,
  /(^|\/)tests?\//,
  /\.(?:md|txt)$/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)package-lock\.json$/,
];

function isReviewablePath(path: string): boolean {
  return !COVERAGE_EXCLUDES.some((pattern) => pattern.test(stripSandboxPrefix(path)));
}

function calculateCoverage(input: AssessInput): AssessmentCoverage {
  const reviewableFiles = [...new Set(
    input.diff.files
      .map((file) => stripSandboxPrefix(file.path))
      .filter(isReviewablePath),
  )].sort();
  const selected = selectTruths(input.registry, input.repo, input.diff)
    .filter((item) => isLive(item.truth));
  const unavailableFiles = input.diff.files
    .filter((file) => !file.patchAvailable)
    .map((file) => stripSandboxPrefix(file.path))
    .filter(isReviewablePath)
    .sort();
  const unavailable = new Set(unavailableFiles);
  const coveredFiles = reviewableFiles.filter((path) =>
    !unavailable.has(path) &&
    selected.some((item) => pathInScope(item.truth, path) || item.reasons.includes("always_on") || item.reasons.includes("product_catalog")),
  );
  const covered = new Set(coveredFiles);
  const uncoveredFiles = reviewableFiles.filter((path) => !covered.has(path));
  const status = coveredFiles.length === 0
    ? "none"
    : uncoveredFiles.length === 0
      ? "full"
      : "partial";
  return { status, reviewableFiles, coveredFiles, uncoveredFiles, unavailableFiles };
}

function truthCoverage(input: AssessInput, findings: Finding[]): TruthCoverage {
  const gaps: GapRecord[] = input.registry.truths
    .filter((truth) => isVisibleGap(truth) && repoMatches(truth.applies_to.repositories, input.repo))
    .map((truth) => ({
      truthId: truth.id,
      title: truth.title,
      status: truth.status,
      statement: truth.statement,
      executor: truth.executor.kind,
    }));
  const live = input.registry.truths.filter((truth) =>
    isLive(truth) && repoMatches(truth.applies_to.repositories, input.repo),
  ).length;
  return {
    live,
    selected: findings.length,
    failed: findings.filter((finding) => finding.verdict === "fail").length,
    passed: findings.filter((finding) => finding.verdict === "pass").length,
    gaps,
  };
}

export function assess(input: AssessInput): Assessment {
  const selected = selectTruths(input.registry, input.repo, input.diff);
  const liveSelected = selected.filter((item) => isLive(item.truth));
  const workspace = overlayWorkspace(input.workspace, createDiffWorkspace(input.diff));
  const findings: Finding[] = liveSelected.map((item) => {
    const result = runExecutor({
      truth: item.truth,
      diff: input.diff,
      workspace,
      repo: input.repo,
    });
    const blocking = item.truth.executor.blocking !== false;
    return {
      truthId: item.truth.id,
      title: item.truth.title,
      statement: item.truth.statement,
      executor: item.truth.executor.kind,
      emit: item.truth.executor.emit ?? "none",
      blocking,
      verdict: result.verdict,
      reason: result.reason,
      evidence: result.evidence,
      matchReasons: item.reasons,
      requiredGuards: item.truth.required_guards ?? [],
      references: item.truth.evidence,
    };
  });

  const coverage = calculateCoverage(input);
  const failed = findings.filter((finding) => finding.verdict === "fail" && finding.blocking);

  let verdict: Verdict = "inconclusive";
  let outcome: AssessmentOutcome = "no_selected_truth";
  if (failed.length > 0) {
    verdict = "fail";
    outcome = "fact_failed";
  } else if (findings.length > 0) {
    verdict = "pass";
    outcome = "selected_truths_hold";
  }

  return {
    verdict,
    outcome,
    tenant: input.registry.tenant.id,
    repo: input.repo,
    sha: input.sha,
    pr: input.pr,
    source: input.source,
    findings,
    selected: selected.map((item) => item.truth.id),
    truthsLoaded: input.registry.truths.length,
    truthsEvaluated: findings.length,
    coverage,
    truthCoverage: truthCoverage(input, findings),
  };
}
