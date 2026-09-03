import { runExecutor } from "./executors/index.ts";

type ExecutorVerdict = ReturnType<typeof runExecutor>["verdict"];
import { isLive, isVisibleGap, pathInScope, selectTruths } from "./match.ts";
import { stripSandboxPrefix } from "./diff.ts";
import { createDiffWorkspace, overlayWorkspace } from "./workspace.ts";
import { matchesGlob, repoMatches } from "./glob.ts";
import type {
  AssessInput,
  Assessment,
  AssessmentCoverage,
  AssessmentOutcome,
  FailureClass,
  Finding,
  FindingEvidence,
  GapRecord,
  ProofScope,
  Truth,
  TruthCoverage,
  TruthException,
  Verdict,
  WaivedFinding,
  Workspace,
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

/**
 * Whether this truth's executor would actually read `path`.
 *
 * Coverage must reflect inspection, not selection. A truth selected because it
 * is `always_on` does not thereby inspect every file in the change: a product
 * truth reads only the files it names, and a delegated truth reads nothing at
 * all. Counting selection as coverage reports "full" for files no executor
 * opened, which then feeds a green check.
 */
function truthInspects(truth: Truth, path: string): boolean {
  if (truth.executor.kind === "coderabbit") return false;
  if (truth.executor.kind === "product") {
    return (truth.executor.files ?? []).some((file) => stripSandboxPrefix(file) === path);
  }
  return pathInScope(truth, path);
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
    selected.some((item) => truthInspects(item.truth, path)),
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

/**
 * Whether this change is answerable for the failure.
 *
 * Evidence from a line this change added is always this change's. Evidence from
 * the checkout has to be settled by asking the same question of the state before
 * the change:
 *
 *   holds at base, fails at head  → introduced
 *   fails at base and at head     → pre-existing
 *   no base state available       → unknown, and never gating
 *
 * The previous rule — "did the change touch the file the evidence points at?" —
 * was wrong in a way that mattered. A change that edits
 * `content-sources.service.ts` without adding any SocialGateway gate was
 * reported as having *introduced* IRIS-TRUTH-0009, purely for touching the file
 * the standing leftover happens to live in. In error mode that would eventually
 * block an innocent change, which is exactly the credibility the trial needs.
 */
function classifyFailure(
  truth: Truth,
  evidence: FindingEvidence,
  base: Workspace | undefined,
  input: AssessInput,
): FailureClass {
  if (evidence.scope !== "workspace") return "introduced";
  if (!base) return "unknown";
  // Ask the truth about the base state, with no diff: at base nothing has been
  // added, so only its workspace-facing checks can speak.
  const atBase = runExecutor({
    truth,
    diff: { files: [], raw: "" },
    workspace: base,
    repo: input.repo,
  });
  return atBase.verdict === "fail" ? "preexisting" : "introduced";
}

/**
 * What a result establishes, from the executor that produced it.
 *
 * Mode is the deciding factor: an `added_lines` executor never reads the
 * checkout, so its pass is a statement about the diff and nothing more.
 */
function proofScopeOf(truth: Truth, verdict: ExecutorVerdict): ProofScope {
  if (verdict === "error") return "not_evaluated";
  if (truth.executor.kind === "coderabbit") return "delegated";
  if (verdict === "delegated") return "delegated";
  if (truth.executor.kind === "product" || truth.executor.kind === "decision") {
    return "workspace_fact_holds";
  }
  return (truth.executor.mode ?? "both") === "added_lines"
    ? "no_reintroduction_detected"
    : "workspace_fact_holds";
}

function activeException(
  truth: Truth,
  evidence: FindingEvidence,
  now: Date,
): TruthException | undefined {
  if (!evidence.path) return undefined;
  for (const exception of truth.exceptions ?? []) {
    if (!matchesGlob(evidence.path, exception.path)) continue;
    if (exception.expires && new Date(exception.expires) < now) continue;
    return exception;
  }
  return undefined;
}

function truthCoverage(
  input: AssessInput,
  findings: Finding[],
  waived: WaivedFinding[],
): TruthCoverage {
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
  const failures = findings.filter((finding) => finding.verdict === "fail");
  return {
    live,
    selected: findings.length,
    failed: failures.length,
    introducedFailures: failures.filter((finding) => finding.failureClass === "introduced").length,
    preexistingFailures: failures.filter((finding) => finding.failureClass === "preexisting").length,
    unattributedFailures: failures.filter((finding) => finding.failureClass === "unknown").length,
    passed: findings.filter((finding) =>
      finding.verdict === "pass" && finding.proofScope === "workspace_fact_holds").length,
    noReintroduction: findings.filter((finding) =>
      finding.verdict === "pass" && finding.proofScope === "no_reintroduction_detected").length,
    delegated: findings.filter((finding) => finding.verdict === "delegated").length,
    errored: findings.filter((finding) => finding.verdict === "error").length,
    waived: waived.length,
    gaps,
  };
}

export function assess(input: AssessInput): Assessment {
  const now = input.now ?? new Date();
  const selected = selectTruths(input.registry, input.repo, input.diff);
  const liveSelected = selected.filter((item) => isLive(item.truth));
  const workspace = overlayWorkspace(input.workspace, createDiffWorkspace(input.diff));
  const findings: Finding[] = [];
  const waived: WaivedFinding[] = [];

  for (const item of liveSelected) {
    // One truth's executor throwing must not abort the run and discard every
    // other finding. A thrown executor is a configuration or environment
    // problem, not a regression, so it is surfaced as non-blocking.
    let result: ReturnType<typeof runExecutor>;
    let blocking = item.truth.executor.blocking !== false;
    try {
      result = runExecutor({
        truth: item.truth,
        diff: input.diff,
        workspace,
        baseWorkspace: input.baseWorkspace,
        repo: input.repo,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Not a failed fact. A truth that could not run has proved nothing, in
      // either direction, and reporting it as a failure invites someone to
      // "fix" a configuration problem by editing product code.
      result = {
        verdict: "error",
        reason: `${item.truth.id} could not be evaluated: ${message}`,
        evidence: { kind: "none", detail: `executor error: ${message}`, scope: "none" },
      };
      blocking = false;
    }

    if (result.verdict === "fail") {
      const exception = activeException(item.truth, result.evidence, now);
      if (exception) {
        waived.push({
          truthId: item.truth.id,
          title: item.truth.title,
          path: result.evidence.path ?? exception.path,
          reason: exception.reason,
          approvedBy: exception.approved_by,
          expires: exception.expires,
          evidence: result.evidence,
        });
        continue;
      }
    }

    findings.push({
      truthId: item.truth.id,
      title: item.truth.title,
      statement: item.truth.statement,
      executor: item.truth.executor.kind,
      emit: item.truth.executor.emit ?? "none",
      blocking,
      verdict: result.verdict,
      proofScope: proofScopeOf(item.truth, result.verdict),
      ...(result.verdict === "fail"
        ? { failureClass: classifyFailure(item.truth, result.evidence, input.baseWorkspace, input) }
        : {}),
      reason: result.reason,
      evidence: result.evidence,
      matchReasons: item.reasons,
      requiredGuards: item.truth.required_guards ?? [],
      references: item.truth.evidence,
      ...(item.truth.proves ? { proves: item.truth.proves } : {}),
    });
  }

  const coverage = calculateCoverage(input);
  const blockingFailures = findings.filter(
    (finding) => finding.verdict === "fail" && finding.blocking,
  );
  const introduced = blockingFailures.filter((finding) => finding.failureClass === "introduced");
  const errored = findings.filter((finding) => finding.verdict === "error");
  const verified = findings.filter(
    (finding) => finding.verdict === "pass" || finding.verdict === "fail",
  );

  // A non-blocking truth that failed is still a fact that is no longer true. It
  // must not gate anything, but reporting "selected truths hold" above a
  // rendered failure would be a lie in the headline.
  const advisoryFailures = findings.filter(
    (finding) => finding.verdict === "fail" && !finding.blocking,
  );
  const unattributed = blockingFailures.filter((finding) => finding.failureClass === "unknown");

  let verdict: Verdict = "inconclusive";
  let outcome: AssessmentOutcome = "no_selected_truth";
  if (introduced.length > 0) {
    verdict = "fail";
    outcome = "fact_failed";
  } else if (unattributed.length > 0) {
    verdict = "fail";
    outcome = "unattributed_fact_failed";
  } else if (blockingFailures.length > 0) {
    verdict = "fail";
    outcome = "preexisting_fact_failed";
  } else if (advisoryFailures.length > 0) {
    verdict = "fail";
    outcome = "advisory_fact_failed";
  } else if (verified.length > 0) {
    verdict = "pass";
    outcome = "selected_truths_hold";
  } else if (errored.length > 0) {
    verdict = "inconclusive";
    outcome = "not_evaluated";
  } else if (findings.length > 0) {
    // Every selected truth was delegated. Nothing was verified, so this is not
    // a pass.
    verdict = "inconclusive";
    outcome = "only_delegated";
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
    waived,
    selected: selected.map((item) => item.truth.id),
    truthsLoaded: input.registry.truths.length,
    truthsEvaluated: findings.length,
    coverage,
    truthCoverage: truthCoverage(input, findings, waived),
    revision: input.revision ?? {
      verified: false,
      note: "No revision provenance was supplied; workspace conclusions are unverified.",
    },
    baselineAvailable: Boolean(input.baseWorkspace),
  };
}
