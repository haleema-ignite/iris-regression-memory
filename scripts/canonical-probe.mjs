/**
 * Assess named refs of the real IRIS repositories and compare the result with
 * what the registry claims about current state.
 *
 * This exists because prose claims about "the code" went wrong three times.
 * Truths were written from dirty local feature branches: IRIS-TRUTH-0012 was
 * demoted on the belief that a guard did not exist when it was present on both
 * canonical branches, and a whole proposal was filed asserting a fix had been
 * reverted when it simply had not merged down yet.
 *
 * A unit test cannot catch that class of error, because the mistake is in the
 * premise rather than the logic. Only materializing a named commit can.
 *
 * Read-only: materializes refs with `git archive` into temporary directories and
 * never writes to any repository.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "dist", "cli.cjs");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const irisRoot = resolve(argValue("--iris-root", resolve(repoRoot, "..")));
const refs = (argValue("--refs", "origin/main,origin/develop")).split(",").map((ref) => ref.trim());

/**
 * What the registry asserts about each repository at a canonical ref.
 *
 * `mustPass` / `mustFail` are the claims in docs/iris.md. When one of these
 * stops matching, either the code moved or the claim was wrong — and both are
 * worth knowing before anyone quotes the registry at a teammate.
 */
const CLAIMS = [
  {
    directory: "iris-sp-engines",
    repo: "ignitetech-group/iris-sp-engines",
    probePath: "engines/community/src/polling/polling.component.ts",
    mustPass: ["IRIS-TRUTH-0012"],
    mustFail: [],
    // The IRISNG-3231 guards, and the two files they really live in. The
    // demotion of 0012 rested on believing these were absent.
    present: [
      { token: "resolveBoardVisibility", paths: ["engines/community/src/polling/**"] },
      { token: "cfg.includeHidden", paths: ["engines/community/src/polling/**"] },
      { token: "'unknown-board'", paths: ["engines/community/src/polling/**"] },
    ],
  },
  {
    directory: "iris-api",
    repo: "ignitetech-group/iris-api",
    probePath: "src/services/smm/content-sources.service.ts",
    // 0009 fails on main and holds on develop, so it is asserted per ref below.
    mustFail: [],
    // 0005 is an added-lines truth, so a comment-only probe diff would pass it
    // trivially and prove nothing. What is actually claimed about canonical
    // code is that the offending write is absent — a token fact, not an
    // assessment fact. An earlier draft asserted the opposite from a dirty
    // feature branch.
    absent: [
      { token: "provider: 'applebc'", paths: ["src/**"] },
    ],
    perRef: {
      "origin/main": { mustFail: ["IRIS-TRUTH-0009"] },
      "origin/develop": { mustPass: ["IRIS-TRUTH-0009"] },
    },
  },
  {
    directory: "iris-web",
    repo: "ignitetech-group/iris-web",
    probePath: "src/features/publishing/calendar/components/PublisherCalendarHeader.tsx",
    mustPass: ["IRIS-TRUTH-0001", "IRIS-TRUTH-0002"],
    mustFail: ["IRIS-TRUTH-0003"],
  },
];

/** How many times `token` occurs under `paths` at `ref`. */
function tokenCount(checkout, ref, token, paths) {
  const result = git(checkout, ["grep", "-c", "-F", token, ref, "--", ...paths]);
  if (result.status !== 0) return 0;
  return String(result.stdout ?? "")
    .split("\n")
    .filter(Boolean)
    .reduce((sum, line) => sum + Number(line.split(":").pop() || 0), 0);
}

function git(cwd, args, encoding = "utf8") {
  return spawnSync("git", ["-C", cwd, ...args], { encoding, maxBuffer: 400 * 1024 * 1024 });
}

function materialize(checkout, ref) {
  const sha = git(checkout, ["rev-parse", `${ref}^{commit}`]);
  if (sha.status !== 0) return undefined;
  const dir = mkdtempSync(join(tmpdir(), "truth-compiler-probe-"));
  const archive = git(checkout, ["archive", sha.stdout.trim()], "buffer");
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
  return { dir, sha: sha.stdout.trim() };
}

/**
 * A one-line diff touching a path the claim cares about, so path-scoped truths
 * are selected. The content is a comment, so it introduces nothing.
 */
function probeDiff(path) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,2 @@",
    " // probe",
    "+// canonical provenance probe: introduces nothing",
  ].join("\n");
}

if (!existsSync(cliPath)) {
  throw new Error("dist/cli.cjs is missing. Run npm run build first.");
}

let failures = 0;
process.stdout.write("Canonical provenance probe\n");
process.stdout.write(`IRIS checkouts: ${irisRoot}\n`);
process.stdout.write(`Refs: ${refs.join(", ")}\n\n`);

for (const claim of CLAIMS) {
  const checkout = join(irisRoot, claim.directory);
  if (!existsSync(join(checkout, ".git"))) {
    process.stdout.write(`${claim.directory}: not present, skipped\n`);
    continue;
  }
  for (const ref of refs) {
    const tree = materialize(checkout, ref);
    if (!tree) {
      process.stdout.write(`${claim.directory} ${ref}: could not materialize, skipped\n`);
      continue;
    }
    try {
      const run = spawnSync(
        process.execPath,
        [
          cliPath, "assess",
          "--tenant", "iris",
          "--repo", claim.repo,
          "--diff-file", "/dev/stdin",
          "--workspace", tree.dir,
          "--json",
        ],
        {
          cwd: repoRoot,
          input: probeDiff(claim.probePath),
          encoding: "utf8",
          maxBuffer: 50 * 1024 * 1024,
          env: { ...process.env, TRUTH_COMPILER_ROOT: repoRoot },
        },
      );
      if (!run.stdout.trim()) {
        throw new Error(`no JSON from the assessor: ${String(run.stderr).trim()}`);
      }
      const assessment = JSON.parse(run.stdout);
      const byId = new Map(assessment.findings.map((finding) => [finding.truthId, finding.verdict]));
      const perRef = claim.perRef?.[ref] ?? {};
      const mustPass = [...(claim.mustPass ?? []), ...(perRef.mustPass ?? [])];
      const mustFail = [...(claim.mustFail ?? []), ...(perRef.mustFail ?? [])];

      const problems = [];
      for (const claimed of claim.present ?? []) {
        if (tokenCount(checkout, ref, claimed.token, claimed.paths) === 0) {
          problems.push(`\`${claimed.token}\` is absent, claimed present`);
        }
      }
      for (const claimed of claim.absent ?? []) {
        const count = tokenCount(checkout, ref, claimed.token, claimed.paths);
        if (count > 0) {
          problems.push(`\`${claimed.token}\` occurs ${count} time(s), claimed absent`);
        }
      }
      for (const id of mustPass) {
        const verdict = byId.get(id);
        if (verdict !== "pass") problems.push(`${id} is ${verdict ?? "not selected"}, claimed to hold`);
      }
      for (const id of mustFail) {
        const verdict = byId.get(id);
        if (verdict !== "fail") problems.push(`${id} is ${verdict ?? "not selected"}, claimed to fail`);
      }

      process.stdout.write(
        `${claim.directory} ${ref} @ ${tree.sha.slice(0, 12)}: ` +
        `${problems.length === 0 ? "claims match" : "CLAIMS DO NOT MATCH"}\n`,
      );
      for (const problem of problems) {
        process.stdout.write(`  - ${problem}\n`);
        failures += 1;
      }
    } finally {
      rmSync(tree.dir, { recursive: true, force: true });
    }
  }
}

process.stdout.write("\n");
if (failures > 0) {
  process.stdout.write(
    `${failures} claim(s) do not match canonical code. Either the code moved or\n` +
    "the registry is asserting something untrue. Fix the truth, or update\n" +
    "docs/iris.md and this probe together.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Every current-state claim matches the canonical refs probed.\n");
}
