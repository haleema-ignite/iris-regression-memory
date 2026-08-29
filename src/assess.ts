import { findingsFromHits } from "./adjudicate.ts";
import { pathExcluded, pathMatches, repoMatches, retrieve } from "./retrieve.ts";
import { stripSandboxPrefix } from "./diff.ts";
import type {
  AssessInput,
  Assessment,
  AssessmentCoverage,
  AssessmentOutcome,
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
  const repoContracts = input.contracts.filter((contract) => repoMatches(contract, input.repo));
  const unavailableFiles = input.diff.files
    .filter((file) => !file.patchAvailable)
    .map((file) => stripSandboxPrefix(file.path))
    .filter(isReviewablePath)
    .sort();
  const unavailable = new Set(unavailableFiles);
  const coveredFiles = reviewableFiles.filter((path) =>
    !unavailable.has(path) &&
    repoContracts.some((contract) => pathMatches(contract, path) && !pathExcluded(contract, path)),
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

export function assess(input: AssessInput): Assessment {
  const hits = retrieve(input.contracts, input.repo, input.diff);
  const availablePaths = new Set(input.diff.files.filter((file) => file.patchAvailable).map((file) => file.path));
  const applicableHits = hits.filter(
    (hit) =>
      hit.contract.status === "approved" &&
      hit.pathMatched &&
      hit.matchedPaths.some((path) => availablePaths.has(path)),
  );
  const findings = findingsFromHits(applicableHits, input.diff);
  const coverage = calculateCoverage(input);

  let verdict: Verdict = "inconclusive";
  let outcome: AssessmentOutcome = "no_applicable_contract";
  if (findings.some((finding) => finding.verdict === "fail")) {
    verdict = "fail";
    outcome = "historical_regression_detected";
  } else if (findings.length > 0) {
    verdict = "pass";
    outcome = "no_known_regression";
  }

  return {
    verdict,
    outcome,
    repo: input.repo,
    sha: input.sha,
    pr: input.pr,
    source: input.source,
    findings,
    retrieved: hits.map((hit) => hit.contract.id),
    contractsLoaded: input.contracts.length,
    contractsEvaluated: findings.length,
    coverage,
  };
}
