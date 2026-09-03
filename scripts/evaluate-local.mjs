import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { parse as parseYaml } from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "benchmarks", "iris-historical.json");
const cliPath = join(repoRoot, "dist", "cli.cjs");

/**
 * Score a case against its per-truth expectations.
 *
 * A single `contract` field could not express the shape of a fix case: PRs 860
 * and 921 are the *fix* for IRIS-BEH-0007, so that truth must pass, while the
 * overall verdict still fails on the unrelated IRIS-TRUTH-0009 leftover. Scored
 * against one field, they looked like "detected only by another truth" and
 * dragged attributed recall down for no reason.
 */
function scoreExpectations(item, findings) {
  const byId = new Map(findings.map((finding) => [finding.truthId, finding]));
  const problems = [];
  for (const id of item.mustFailTruths ?? []) {
    const finding = byId.get(id);
    if (!finding) problems.push(`${id} was not evaluated but must fail`);
    else if (finding.verdict !== "fail") problems.push(`${id} is ${finding.verdict} but must fail`);
  }
  for (const id of item.mustPassTruths ?? []) {
    const finding = byId.get(id);
    if (!finding) problems.push(`${id} was not evaluated but must pass`);
    else if (finding.verdict !== "pass") problems.push(`${id} is ${finding.verdict} but must pass`);
  }
  for (const id of item.mustNotFailTruths ?? []) {
    const finding = byId.get(id);
    if (finding && finding.verdict === "fail") problems.push(`${id} failed but must not`);
  }

  // Exhaustive, not just the named truths.
  //
  // "Zero false positives" was only true at the whole-case level: on an
  // expected-fail case, an extra wrong truth failure changed nothing, and 23
  // cases had an empty mustNotFailTruths so nothing constrained them at all.
  // Every failure now has to be accounted for by name.
  const allowed = new Set([
    ...(item.mustFailTruths ?? []),
    ...(item.alsoAllowedToFail ?? []),
  ]);
  for (const finding of findings) {
    if (finding.verdict !== "fail") continue;
    if (allowed.has(finding.truthId)) continue;
    problems.push(
      `${finding.truthId} failed and is not accounted for ` +
      `(${finding.evidence?.detail ?? "no detail"})`,
    );
  }
  return problems;
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    const output = result.stderr || result.stdout;
    const text = Buffer.isBuffer(output) ? output.toString("utf8") : String(output || "");
    throw new Error(`${label} failed: ${text.trim()}`);
  }
}

function materializeTree(checkout, sha) {
  const dir = mkdtempSync(join(tmpdir(), "truth-compiler-ws-"));
  const archive = spawnSync("git", ["-C", checkout, "archive", sha], {
    encoding: "buffer",
    maxBuffer: 200 * 1024 * 1024,
  });
  requireSuccess(archive, `git archive ${sha}`);
  const extracted = spawnSync("tar", ["-x", "-C", dir], {
    input: archive.stdout,
    encoding: "buffer",
    maxBuffer: 200 * 1024 * 1024,
  });
  requireSuccess(extracted, `tar ${sha}`);
  return dir;
}

function summarize(cases) {
  const summary = {
    total: cases.length,
    matched: cases.filter((item) => item.matched).length,
    expectedFail: 0,
    detectedFail: 0,
    falseNegatives: 0,
    expectedPass: 0,
    falsePositives: 0,
    expectedInconclusive: 0,
    correctAbstentions: 0,
    // Of the expected-fail cases, how many failed on the truth they were filed
    // under rather than on an unrelated standing ratchet.
    expectationsMet: 0,
    expectationsViolated: 0,
    violations: [],
  };

  for (const item of cases) {
    if (item.expected === "fail") {
      summary.expectedFail += 1;
      if (item.actual === "fail") summary.detectedFail += 1;
      else summary.falseNegatives += 1;
    } else if (item.expected === "pass") {
      summary.expectedPass += 1;
      if (item.actual === "fail") summary.falsePositives += 1;
    } else if (item.expected === "inconclusive") {
      summary.expectedInconclusive += 1;
      if (item.actual === "inconclusive") summary.correctAbstentions += 1;
      if (item.actual === "fail") summary.falsePositives += 1;
    }
  }

  for (const item of cases) {
    if ((item.expectationProblems ?? []).length === 0) summary.expectationsMet += 1;
    else {
      summary.expectationsViolated += 1;
      summary.violations.push({ id: item.id, problems: item.expectationProblems });
    }
  }
  summary.recall = summary.expectedFail === 0
    ? null
    : summary.detectedFail / summary.expectedFail;
  // Per case, not per evaluated truth: a case counts only when every named
  // expectation held AND no unaccounted-for truth failed.
  summary.casesMeetingNamedExpectations = cases.length === 0
    ? null
    : summary.expectationsMet / cases.length;
  summary.precision = summary.detectedFail + summary.falsePositives === 0
    ? null
    : summary.detectedFail / (summary.detectedFail + summary.falsePositives);
  const durations = cases.map((item) => item.durationMs).sort((a, b) => a - b);
  const percentile = (fraction) => durations[Math.min(
    durations.length - 1,
    Math.max(0, Math.ceil(durations.length * fraction) - 1),
  )];
  summary.runtimeMs = {
    total: Number(durations.reduce((sum, value) => sum + value, 0).toFixed(1)),
    mean: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1)),
    p50: Number(percentile(0.5).toFixed(1)),
    p95: Number(percentile(0.95).toFixed(1)),
    max: Number(durations[durations.length - 1].toFixed(1)),
  };
  return summary;
}

if (!existsSync(cliPath)) {
  throw new Error("dist/cli.cjs is missing. Run npm run build first.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const workspace = resolve(argValue("--workspace") || resolve(repoRoot, "../.."));
const results = [];

for (const item of manifest.cases) {
  const startedAt = performance.now();
  const checkout = join(workspace, item.localDirectory);
  if (!existsSync(join(checkout, ".git"))) {
    throw new Error(`${item.id}: local checkout not found at ${checkout}`);
  }

  for (const sha of [item.base, item.head]) {
    const present = run("git", ["-C", checkout, "cat-file", "-e", `${sha}^{commit}`]);
    requireSuccess(present, `${item.id}: missing commit ${sha}`);
  }

  const diffArgs = ["-C", checkout, "diff"];
  if (item.reverse) diffArgs.push("-R");
  diffArgs.push("--no-ext-diff", "--unified=3", `${item.base}...${item.head}`);
  const diff = run("git", diffArgs);
  requireSuccess(diff, `${item.id}: git diff`);

  const treeSha = item.reverse ? item.base : item.head;
  const baseSha = item.reverse ? item.head : item.base;
  const materialized = materializeTree(checkout, treeSha);
  // The base tree too, so a workspace failure can be attributed rather than
  // reported as unknown. Without it every ratchet reads as unattributed.
  const materializedBase = materializeTree(checkout, baseSha);
  let assessment;
  try {
    const assessmentRun = run(
      process.execPath,
      [
        cliPath,
        "assess",
        "--tenant",
        "iris",
        "--repo",
        item.repository,
        "--diff-file",
        "/dev/stdin",
        "--workspace",
        materialized,
        "--base-workspace",
        materializedBase,
        "--json",
      ],
      {
        cwd: repoRoot,
        input: diff.stdout,
        env: { ...process.env, TRUTH_COMPILER_ROOT: repoRoot, IRIS_REGRESSION_MEMORY_ROOT: repoRoot },
      },
    );
    if (!assessmentRun.stdout.trim()) {
      throw new Error(`${item.id}: assessor returned no JSON: ${assessmentRun.stderr.trim()}`);
    }
    assessment = JSON.parse(assessmentRun.stdout);
  } finally {
    rmSync(materialized, { recursive: true, force: true });
    rmSync(materializedBase, { recursive: true, force: true });
  }

  results.push({
    id: item.id,
    category: item.category,
    repository: item.repository,
    pr: item.pr,
    incident: item.incident,
    contract: item.contract,
    reverse: Boolean(item.reverse),
    expected: item.expectedVerdict,
    actual: assessment.verdict,
    matched: item.expectedVerdict === assessment.verdict,
    outcome_detail: assessment.outcome,
    expectationProblems: scoreExpectations(item, assessment.findings),
    introducedFailures: assessment.truthCoverage.introducedFailures,
    preexistingFailures: assessment.truthCoverage.preexistingFailures,
    unattributedFailures: assessment.truthCoverage.unattributedFailures,
    delegated: assessment.truthCoverage.delegated,
    diffBytes: Buffer.byteLength(diff.stdout),
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    outcome: assessment.outcome,
    workspaceSha: treeSha,
    findings: assessment.findings.map((finding) => ({
      truthId: finding.truthId ?? finding.contractId,
      executor: finding.executor,
      verdict: finding.verdict,
      evidence: finding.evidence,
    })),
    coverage: assessment.coverage,
  });
}

process.stdout.write(`${JSON.stringify({
  benchmark: manifest.name,
  schemaVersion: manifest.schemaVersion,
  contractRelease: manifest.contractRelease,
  workspace,
  summary: summarize(results),
  cases: results,
}, null, 2)}\n`);
