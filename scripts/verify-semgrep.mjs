/**
 * Validate the emitted Semgrep rules with the real Semgrep CLI.
 *
 * The unit tests only check the emitted YAML structurally — rule ids, paths,
 * the presence of a `pattern-regex`. That cannot tell you Semgrep will accept
 * the config, and it cannot tell you the rules match what we think they match.
 * A rule that Semgrep rejects is worse than no rule: the config fails to load
 * and every other rule in it stops running too.
 *
 * Semgrep is optional for ordinary local use. `--required` makes an absent CLI
 * fail closed for release qualification. `--semgrep-bin` can point at an
 * isolated installation without modifying the caller's PATH.
 *
 * Two things are checked:
 *
 *   1. `semgrep --validate` accepts both emitted configs.
 *   2. The diff-scan config actually matches a known-bad line, and does not
 *      match a known-good one. This is the part that would catch a regex that
 *      compiles but has stopped meaning anything.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const emitters = join(repoRoot, "tenants", "iris", "emitters");
const required = process.argv.includes("--required");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const semgrepBin = argValue("--semgrep-bin", "semgrep");

function semgrep(args, options = {}) {
  return spawnSync(semgrepBin, args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
}

const probe = semgrep(["--version"]);
if (probe.error) {
  process.stdout.write(
    "Semgrep CLI not installed, so the emitted rules were NOT validated against it.\n" +
    `Attempted executable: ${semgrepBin}\n` +
    "The unit tests only check the YAML structurally. Install semgrep " +
    "(`pipx install semgrep`) and re-run `npm run verify:semgrep` before relying\n" +
    "on the emitted config in any repository.\n" +
    (required ? "Strict mode was requested, so this run fails.\n" : ""),
  );
  process.exit(required ? 1 : 0);
}
if (probe.status !== 0) {
  process.stdout.write(
    `Semgrep was found at ${semgrepBin}, but it failed its startup probe.\n` +
    `${(probe.stderr || probe.stdout || "No diagnostic output.").trim()}\n`,
  );
  process.exit(1);
}
process.stdout.write(`Semgrep ${probe.stdout.trim()}\n\n`);

let failures = 0;

for (const name of ["semgrep.yml", "semgrep-diff-scan.yml"]) {
  const path = join(emitters, name);
  if (!existsSync(path)) {
    process.stdout.write(`${name}: missing — run npm run compile\n`);
    failures += 1;
    continue;
  }
  const result = semgrep(["--validate", "--config", path]);
  const ok = result.status === 0;
  process.stdout.write(`${name}: ${ok ? "valid" : "REJECTED BY SEMGREP"}\n`);
  if (!ok) {
    process.stdout.write(`${(result.stderr || result.stdout || "").trim()}\n`);
    failures += 1;
  }
}

// Behavioural check: the diff-scan rules must still match a real violation.
const scratch = mkdtempSync(join(tmpdir(), "truth-semgrep-"));
try {
  // Keep the fixtures inside the rule's real `src/**/*.ts` include scope. A
  // root-level fixture would prove nothing: Semgrep correctly ignores it.
  const sourceDir = join(scratch, "src");
  mkdirSync(sourceDir);
  const bad = join(sourceDir, "bad.ts");
  const good = join(sourceDir, "good.ts");
  writeFileSync(
    bad,
    "export function q(term: string) {\n" +
    "  return db.query(`SELECT id FROM t WHERE use_meta LIKE '%${term}%'`);\n" +
    "}\n",
  );
  writeFileSync(
    good,
    "export function q(term: string) {\n" +
    "  return db.query('SELECT id FROM t WHERE use_meta = ?', [term]);\n" +
    "}\n",
  );
  const config = join(emitters, "semgrep-diff-scan.yml");
  const run = semgrep(["--config", config, "--json", "--quiet", scratch]);
  if (run.status !== 0 && run.status !== 1) {
    process.stdout.write(`\ndiff-scan behavioural check: semgrep failed to run\n${run.stderr}\n`);
    failures += 1;
  } else {
    const report = JSON.parse(run.stdout || "{}");
    const hits = (report.results ?? []).map((item) => item.path);
    const matchedBad = hits.some((path) => path.endsWith("bad.ts"));
    const matchedGood = hits.some((path) => path.endsWith("good.ts"));
    process.stdout.write(
      `\ndiff-scan behavioural check: ` +
      `${matchedBad ? "matched the violation" : "DID NOT match the violation"}, ` +
      `${matchedGood ? "ALSO matched the clean file" : "left the clean file alone"}\n`,
    );
    if (!matchedBad) failures += 1;
    if (matchedGood) failures += 1;
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write("\n");
if (failures > 0) {
  process.stdout.write(`${failures} problem(s) with the emitted Semgrep config.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Emitted Semgrep config is valid and behaves as intended.\n" +
    "Reminder: semgrep-diff-scan.yml must be run with --baseline-commit; a\n" +
    "repository-wide run of those rules reports pre-existing code on purpose.\n",
  );
}
