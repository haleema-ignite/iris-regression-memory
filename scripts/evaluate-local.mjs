import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "benchmarks", "iris-historical.json");
const cliPath = join(repoRoot, "dist", "cli.cjs");

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
    throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim()}`);
  }
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

  summary.recall = summary.expectedFail === 0
    ? null
    : summary.detectedFail / summary.expectedFail;
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

  const assessmentRun = run(
    process.execPath,
    [cliPath, "assess", "--tenant", "iris", "--repo", item.repository, "--diff-file", "/dev/stdin", "--json"],
    {
      cwd: repoRoot,
      input: diff.stdout,
      env: { ...process.env, TRUTH_COMPILER_ROOT: repoRoot, IRIS_REGRESSION_MEMORY_ROOT: repoRoot },
    },
  );
  if (!assessmentRun.stdout.trim()) {
    throw new Error(`${item.id}: assessor returned no JSON: ${assessmentRun.stderr.trim()}`);
  }
  const assessment = JSON.parse(assessmentRun.stdout);
  results.push({
    id: item.id,
    category: item.category,
    repository: item.repository,
    pr: item.pr,
    incident: item.incident,
    contract: item.contract,
    reverse: Boolean(item.reverse),
    expected: item.expected,
    actual: assessment.verdict,
    matched: item.expected === assessment.verdict,
    diffBytes: Buffer.byteLength(diff.stdout),
    durationMs: Number((performance.now() - startedAt).toFixed(1)),
    outcome: assessment.outcome,
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
