import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

function git(cwd, args, encoding = "utf8") {
  return spawnSync("git", ["-C", cwd, ...args], { encoding, maxBuffer: 400 * 1024 * 1024 });
}

/** The commit a checkout is on, and how much uncommitted work sits on top. */
function provenance(checkout) {
  const sha = git(checkout, ["rev-parse", "HEAD"]);
  const branch = git(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const modified = git(checkout, ["status", "--porcelain", "--untracked-files=no"]);
  const untracked = git(checkout, ["ls-files", "--others", "--exclude-standard"]);
  const count = (result) => result.status === 0
    ? result.stdout.split("\n").filter((line) => line.trim().length > 0).length
    : 0;
  return {
    sha: sha.status === 0 ? sha.stdout.trim() : undefined,
    branch: branch.status === 0 ? branch.stdout.trim() : undefined,
    modified: count(modified),
    untracked: count(untracked),
  };
}

/**
 * Materialize a commit so the HEAD audit really is an audit of that commit.
 *
 * Assessing the filesystem and calling the result "HEAD" was wrong: the four
 * local checkouts carry 62, 82, 84 and 8 uncommitted entries, so those results
 * described nobody's commit.
 */
function materializeHead(checkout, sha) {
  const dir = mkdtempSync(join(tmpdir(), "truth-trial-head-"));
  const archive = git(checkout, ["archive", sha], "buffer");
  if (archive.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
  const extracted = spawnSync("tar", ["-x", "-C", dir], {
    input: archive.stdout,
    encoding: "buffer",
    maxBuffer: 400 * 1024 * 1024,
  });
  if (extracted.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return undefined;
  }
  return dir;
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

const baseRef = argValue("--base");
const baseArgs = baseRef ? ["--base", baseRef] : [];
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

process.stdout.write("Committed HEAD audit — each service's actual commit, materialized:\n");
for (const service of present) {
  const checkout = join(irisRoot, service.dir);
  const state = provenance(checkout);
  if (!state.sha) {
    process.stdout.write(`HEAD ${service.repo}: no commit resolved, skipped\n`);
    continue;
  }
  const tree = materializeHead(checkout, state.sha);
  if (!tree) {
    process.stdout.write(`HEAD ${service.repo}: could not materialize ${state.sha.slice(0, 12)}, skipped\n`);
    continue;
  }
  try {
    const assessment = assessService(tree, service.repo, ["--no-diff"]);
    const unexpected = unexpectedHeadFailures(service.repo, assessment);
    headRows.push({
      repo: service.repo,
      sha: state.sha,
      unexpected,
      failed: failedIds(assessment),
      selected: assessment.selected,
    });
    printAssess(`HEAD ${state.branch ?? "?"}@${state.sha.slice(0, 12)}`, service.repo, assessment);
    const expected = EXPECTED_HEAD_RATCHETS[service.repo];
    if (expected) {
      process.stdout.write(`  expected ratchet at this commit: ${expected.join(", ")}\n`);
    }
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

process.stdout.write("\nWORKTREE — the files on disk, including uncommitted and untracked work:\n");
for (const service of present) {
  const checkout = join(irisRoot, service.dir);
  const state = provenance(checkout);
  const assessment = assessService(checkout, service.repo, baseArgs);
  localRows.push({ repo: service.repo, failed: failedIds(assessment), selected: assessment.selected });
  printAssess("WORKTREE", service.repo, assessment);
  process.stdout.write(
    `  ${state.branch ?? "?"} at ${(state.sha ?? "").slice(0, 12)}` +
    `, ${state.modified} modified, ${state.untracked} untracked` +
    `${state.modified + state.untracked > 0 ? " — NOT a named revision" : " — clean"}\n`,
  );
  process.stdout.write(`  base: ${assessment.revision.baseSha
    ? assessment.revision.baseSha.slice(0, 12)
    : "none resolved, so failures are reported as unattributed"}\n`);
  process.stdout.write(`  source: ${assessment.source}\n`);
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

const gaps = catalog.truths
  .filter((truth) => truth.status === "gap")
  .map((truth) => truth.id);
const proposals = catalog.truths
  .filter((truth) => truth.status === "proposed")
  .map((truth) => truth.id);
process.stdout.write(`\nVisible gaps stay in the registry: ${gaps.join(", ") || "none"}.\n`);
process.stdout.write(`Proposals awaiting an owner: ${proposals.join(", ") || "none"}.\n`);
process.stdout.write("This trial is local. It does not write to GitHub.\n");
process.stdout.write(
  "Exercised here: pattern, product, contract, decision and semgrep executors, " +
  "emitter compile, and the historical benchmark. The MCP server is built but " +
  "this runner does not make a protocol call, and the emitted Semgrep YAML is " +
  "checked structurally rather than run through the Semgrep CLI.\n",
);

const surprise = headRows.filter((row) => row.unexpected.length > 0);
const localFails = localRows.filter((row) => row.failed.length > 0);
if (surprise.length > 0) {
  process.stderr.write(`\nUnexpected blocking failures on checkout HEAD:\n${JSON.stringify(surprise, null, 2)}\n`);
  process.exitCode = 1;
} else if (strict && localFails.length > 0) {
  process.stderr.write(`\n--strict: local working-tree failures:\n${JSON.stringify(localFails, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "\nLocal trial surface completed. WORKTREE findings are your branch and your " +
    "uncommitted work, not a broken compiler. The HEAD audit above is the one " +
    "tied to a named commit.\n",
  );
}
