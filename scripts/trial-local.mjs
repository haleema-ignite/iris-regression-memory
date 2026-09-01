import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SERVICES = [
  { dir: "iris-web", repo: "ignitetech-group/iris-web" },
  { dir: "iris-api", repo: "ignitetech-group/iris-api" },
  { dir: "iris-sp-engines", repo: "ignitetech-group/iris-sp-engines" },
  { dir: "iris-e2e", repo: "ignitetech-group/iris-e2e" },
];

const EXPECTED_HEAD_RATCHETS = {
  "ignitetech-group/iris-web": ["IRIS-TRUTH-0003"],
  "ignitetech-group/iris-api": ["IRIS-TRUTH-0009"],
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    cwd: repoRoot,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${(result.stderr || result.stdout || "").trim()}`);
  }
}

function findIrisRoot() {
  const requested = argValue("--iris-root") || process.env.IRIS_ROOT;
  const candidates = [
    requested,
    resolve(repoRoot, "../.."),
    resolve(repoRoot, ".."),
    process.cwd(),
  ].filter(Boolean);
  for (const root of candidates) {
    if (SERVICES.some((service) => existsSync(join(root, service.dir, ".git")))) {
      return resolve(root);
    }
  }
  throw new Error(
    "No local IRIS checkouts found. Pass --iris-root /path/to/IRIS (the folder that contains iris-web, iris-api, iris-sp-engines, iris-e2e).",
  );
}

function npmRun(script) {
  const result = run("npm", ["run", script], { env: process.env });
  requireSuccess(result, `npm run ${script}`);
  return result;
}

function assessService(checkout, repo, extraArgs = []) {
  const result = run(process.execPath, [
    "--import",
    "tsx",
    "src/cli.ts",
    "assess",
    "--tenant",
    "iris",
    "--repo",
    repo,
    "--workspace",
    checkout,
    "--json",
    "--enforcement",
    "warning",
    ...extraArgs,
  ], {
    env: { ...process.env, TRUTH_COMPILER_ROOT: repoRoot, IRIS_REGRESSION_MEMORY_ROOT: repoRoot },
  });
  if (!result.stdout.trim()) {
    throw new Error(`${repo}: assess returned no JSON\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function failedIds(assessment) {
  return assessment.findings
    .filter((finding) => finding.verdict === "fail" && finding.blocking)
    .map((finding) => finding.truthId);
}

function unexpectedHeadFailures(repo, assessment) {
  const expected = new Set(EXPECTED_HEAD_RATCHETS[repo] ?? []);
  return failedIds(assessment).filter((id) => !expected.has(id));
}

function printAssess(label, repo, assessment) {
  const failed = failedIds(assessment);
  process.stdout.write(`${label} ${repo}: ${assessment.verdict}`);
  process.stdout.write(`  selected ${assessment.selected.length}`);
  if (failed.length > 0) {
    process.stdout.write(`  failed ${failed.join(", ")}`);
  }
  process.stdout.write("\n");
}

const skipCheck = hasFlag("--skip-check");
const skipBenchmark = hasFlag("--skip-benchmark");
const strict = hasFlag("--strict");
const irisRoot = findIrisRoot();

process.stdout.write(`Truth Compiler local team trial\n`);
process.stdout.write(`Compiler: ${repoRoot}\n`);
process.stdout.write(`IRIS checkouts: ${irisRoot}\n\n`);

if (!skipCheck) {
  npmRun("check");
  process.stdout.write("Unit tests, typecheck, compile, and build passed.\n\n");
}

const listed = run(process.execPath, ["--import", "tsx", "src/cli.ts", "list", "--tenant", "iris"]);
requireSuccess(listed, "list");
const catalog = JSON.parse(listed.stdout);
process.stdout.write(`Live and gap truths loaded: ${catalog.truths.length}\n`);
process.stdout.write(`Executors: ${[...new Set(catalog.truths.map((truth) => truth.executor))].sort().join(", ")}\n\n`);

const present = SERVICES.filter((service) => existsSync(join(irisRoot, service.dir, ".git")));
if (present.length === 0) {
  throw new Error(`No service checkouts under ${irisRoot}`);
}

const headRows = [];
const localRows = [];
process.stdout.write("Checkout facts (no diff — product, leftover, always-on):\n");
for (const service of present) {
  const checkout = join(irisRoot, service.dir);
  const assessment = assessService(checkout, service.repo, ["--no-diff"]);
  const unexpected = unexpectedHeadFailures(service.repo, assessment);
  headRows.push({ repo: service.repo, unexpected, failed: failedIds(assessment), selected: assessment.selected });
  printAssess("HEAD", service.repo, assessment);
  const expected = EXPECTED_HEAD_RATCHETS[service.repo];
  if (expected) {
    process.stdout.write(`  expected current-HEAD ratchet: ${expected.join(", ")}\n`);
  }
}

process.stdout.write("\nWorking tree vs main/master (your local branch and uncommitted work):\n");
for (const service of present) {
  const checkout = join(irisRoot, service.dir);
  const assessment = assessService(checkout, service.repo);
  localRows.push({ repo: service.repo, failed: failedIds(assessment), selected: assessment.selected });
  printAssess("DIFF", service.repo, assessment);
}

if (!skipBenchmark) {
  const cliPath = join(repoRoot, "dist", "cli.cjs");
  if (!existsSync(cliPath)) npmRun("build");
  process.stdout.write("\nRunning historical local benchmark (git archive of each head)...\n");
  const evaluated = run(process.execPath, ["scripts/evaluate-local.mjs", "--workspace", irisRoot], {
    env: { ...process.env, TRUTH_COMPILER_ROOT: repoRoot, IRIS_REGRESSION_MEMORY_ROOT: repoRoot },
  });
  requireSuccess(evaluated, "evaluate:local");
  const report = JSON.parse(evaluated.stdout);
  process.stdout.write(
    `Benchmark ${report.summary.matched}/${report.summary.total} matched, ` +
    `FP ${report.summary.falsePositives}, FN ${report.summary.falseNegatives}\n`,
  );
}

process.stdout.write("\nVisible gaps stay in the registry: IRIS-TRUTH-0016 (LIQL), IRIS-TRUTH-0017 (Publisher AI).\n");
process.stdout.write("This trial is local. It does not write to GitHub.\n");
process.stdout.write("Full feature set: pattern, product, contract, decision, semgrep, coderabbit emit, compile, MCP assess_checkout, historical benchmark.\n");

const surprise = headRows.filter((row) => row.unexpected.length > 0);
const localFails = localRows.filter((row) => row.failed.length > 0);
if (surprise.length > 0) {
  process.stderr.write(`\nUnexpected blocking failures on checkout HEAD:\n${JSON.stringify(surprise, null, 2)}\n`);
  process.exitCode = 1;
} else if (strict && localFails.length > 0) {
  process.stderr.write(`\n--strict: local working-tree failures:\n${JSON.stringify(localFails, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nLocal trial surface completed. DIFF findings are your branch; they are not a broken compiler.\n");
}
