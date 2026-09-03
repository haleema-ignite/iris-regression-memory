import { matchesAnyGlob } from "../glob.ts";
import { pathExcluded, pathInScope } from "../match.ts";
import {
  containsIgnoreCase,
  normalizeLine,
  stripComments,
  stripCommentsFromLine,
  lineMatches,
} from "../text.ts";
import { afterStateFromDiff } from "../workspace.ts";
import type {
  DiffFile,
  EvidenceScope,
  FindingEvidence,
  ParsedDiff,
  Truth,
  Workspace,
} from "../types.ts";

export interface ExecutorContext {
  truth: Truth;
  diff: ParsedDiff;
  workspace: Workspace;
  /** The checkout before the change, when one could be materialized. */
  baseWorkspace?: Workspace;
  repo: string;
}

/** The line-level reading context implied by an executor context. */
export function lineViewOf(ctx: ExecutorContext): LineView {
  return { workspace: ctx.workspace, base: ctx.baseWorkspace };
}

export interface ExecutorResult {
  verdict: "pass" | "fail" | "delegated" | "error";
  reason: string;
  evidence: FindingEvidence;
}

export function pass(detail: string): ExecutorResult {
  return {
    verdict: "pass",
    reason: detail,
    evidence: { kind: "none", detail, scope: "none" },
  };
}

/**
 * The compiler verified nothing and is handing the question to a contextual
 * reviewer. Deliberately not `pass`: counting a hand-off as a verified fact is
 * exactly the invented pass this design exists to avoid.
 */
export function delegated(reason: string, detail: string): ExecutorResult {
  return {
    verdict: "delegated",
    reason,
    evidence: { kind: "delegated", detail, scope: "none" },
  };
}

export function fail(reason: string, evidence: FindingEvidence): ExecutorResult {
  return { verdict: "fail", reason, evidence };
}

export function relevantDiffFiles(truth: Truth, diff: ParsedDiff): DiffFile[] {
  return diff.files.filter((file) => pathInScope(truth, file.path) && file.patchAvailable);
}

export function isAllowlisted(truth: Truth, filePath: string): boolean {
  return pathExcluded(truth, filePath) || matchesAnyGlob(filePath, truth.executor.allowlist_paths);
}

/** Files larger than this are not source we can meaningfully token-match. */
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * Minified, generated and vendored artefacts produce token matches that are not
 * authored code. Workspace scans skip them.
 */
const GENERATED_PATHS = [
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/*.snap",
  "**/__snapshots__/**",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.bundle.js",
];

export function isScannableBody(body: string): boolean {
  if (body.length > MAX_SCAN_BYTES) return false;
  // A NUL byte in the first block is the conventional binary test.
  return !body.slice(0, 8000).includes("\u0000");
}

export function isGeneratedPath(path: string): boolean {
  return matchesAnyGlob(path, GENERATED_PATHS);
}

/** The full content of the file after the change, preferring a real checkout. */
export function afterState(file: DiffFile, workspace?: Workspace): string {
  const fromWorkspace = workspace?.read(file.path);
  if (fromWorkspace !== undefined) return fromWorkspace;
  return afterStateFromDiff(file);
}

export function workspaceBodies(
  truth: Truth,
  workspace: Workspace,
  extraPaths: string[] = [],
): Array<{ path: string; body: string }> {
  // Union, not replace.
  //
  // `extraPaths` is the change's in-scope files, so short-circuiting on it made
  // a whole-checkout ratchet inspect only the current pull request's files the
  // moment that pull request touched anything in scope. The ratchet was
  // therefore loudest on changes that touched nothing relevant and silent on
  // changes to the very directory it guards.
  const fromList = [
    ...(truth.executor.files ?? []),
    ...extraPaths,
    ...workspace.list(truth.applies_to.paths ?? ["**/*"]),
  ];
  const seen = new Set<string>();
  const out: Array<{ path: string; body: string }> = [];
  for (const path of fromList) {
    if (seen.has(path) || isAllowlisted(truth, path) || isGeneratedPath(path)) continue;
    seen.add(path);
    const body = workspace.read(path);
    if (body === undefined || !isScannableBody(body)) continue;
    out.push({ path, body });
  }
  return out;
}

/**
 * Resolve each changed line to its comment-free form by locating it in the
 * materialized file, rather than stripping the diff line on its own.
 *
 * A diff line carries no syntactic context. Stripped in isolation, a line in
 * the middle of a block comment looks like code:
 *
 *   /*
 *   const sql = `SELECT * FROM t WHERE x LIKE '%value%'`;
 *   *\/
 *
 * Every line of that addition was reported as introduced code. Line numbers
 * from the hunk headers let us read the same lines out of the whole file after
 * comment stripping, where the block is correctly gone.
 *
 * Falls back to per-line stripping when the file is unavailable or the line
 * numbers do not fit it — a diff and a checkout that disagree must not silently
 * produce confident answers.
 */
function resolvedLines(
  lines: string[],
  lineNumbers: number[],
  path: string,
  body: string | undefined,
): string[] {
  if (body !== undefined && lineNumbers.length === lines.length) {
    const stripped = stripComments(body, path).split("\n");
    const highest = lineNumbers.reduce((max, value) => Math.max(max, value), 0);
    if (highest > 0 && stripped.length >= highest) {
      const mapped = lineNumbers.map((lineNumber) => stripped[lineNumber - 1] ?? "");
      if (mappingAgrees(lines, mapped, path)) return mapped;
    }
  }
  return lines.map((line) => stripCommentsFromLine(line, path));
}

/**
 * Whether the line-number mapping actually landed on the same lines.
 *
 * `body` may not be the file the diff describes — it can be a reconstruction
 * from hunk context, or a checkout at a different revision. Length alone does
 * not detect that: a short reconstruction can still be long enough to index
 * into, and then every answer is confidently wrong.
 *
 * A mapped line is consistent when it is empty (the whole-file view removed a
 * comment the per-line view could not see, which is the case this mapping
 * exists for) or when it matches the diff line ignoring comments and
 * whitespace. Anything else means the two views are looking at different code.
 */
function mappingAgrees(lines: string[], mapped: string[], path: string): boolean {
  const flatten = (value: string): string => value.replace(/\s+/g, " ").trim();
  for (let index = 0; index < lines.length; index += 1) {
    const candidate = flatten(mapped[index] ?? "");
    if (candidate.length === 0) continue;
    if (candidate !== flatten(stripCommentsFromLine(lines[index] ?? "", path))) return false;
  }
  return true;
}

/**
 * How many times each normalized line occurs. Counts, not a set: pairing an
 * added line against a removed one has to be one-for-one.
 */
function normalizedCounts(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pair each line in `lines` against an available match in `available`,
 * consuming the match. Unpaired lines are returned as code.
 *
 * Set membership was wrong here. Copying an already-violating query into a
 * second call site adds two identical lines and removes one; a set said "this
 * line was also removed" for both copies and reported nothing, so the new
 * violation was missed entirely.
 */
function unpairedCodeLines(lines: string[], available: Map<string, number>): string[] {
  const remaining = new Map(available);
  const out: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) continue;
    const left = remaining.get(normalized) ?? 0;
    if (left > 0) {
      remaining.set(normalized, left - 1);
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * The checkouts a line-level reading is resolved against. `workspace` is the
 * state after the change; `base` is the state before it, when available.
 */
export interface LineView {
  workspace?: Workspace;
  base?: Workspace;
}

/** Comment-free added lines, resolved against the file after the change. */
function addedCode(file: DiffFile, workspace?: Workspace): string[] {
  return resolvedLines(
    file.addedLines,
    file.addedLineNumbers,
    file.path,
    workspace?.read(file.path) ?? afterStateFromDiff(file),
  );
}

/**
 * Comment-free removed lines, resolved against the file before the change when
 * a base checkout is available. Without one, per-line stripping is the best
 * available reading of a line that no longer exists anywhere.
 */
function removedCode(file: DiffFile, base?: Workspace): string[] {
  return resolvedLines(file.removedLines, file.removedLineNumbers, file.path, base?.read(file.path));
}

export function newCodeLines(file: DiffFile, workspace?: Workspace, base?: Workspace): string[] {
  return unpairedCodeLines(
    addedCode(file, workspace),
    normalizedCounts(removedCode(file, base)),
  );
}

export function removedCodeLines(file: DiffFile, base?: Workspace): string[] {
  return removedCode(file, base).filter((line) => line.trim().length > 0);
}

/**
 * Removed lines that this change did not put straight back.
 *
 * `newCodeLines` already drops added lines identical to a removed line, so
 * counting those same removed lines again as "violations this change deleted"
 * would credit the change twice for one unchanged line. That double discount
 * hid a genuine second violation added alongside an untouched first one.
 */
function removedAndNotReadded(file: DiffFile, view: LineView): string[] {
  return unpairedCodeLines(
    removedCode(file, view.base),
    normalizedCounts(addedCode(file, view.workspace)),
  );
}

/**
 * Report only when a change increases the number of violating lines in a file.
 *
 * Editing a line that already violated — adding a condition to a query that
 * already had a leading-wildcard LIKE, splitting it across lines, renaming a
 * column in it — removes one match and adds one back. That is not a
 * reintroduction, and reporting it is how a reintroduction check turns into
 * noise on every refactor of an already-non-compliant file.
 */
function increasesMatchCount(
  file: DiffFile,
  view: LineView,
  matches: (line: string) => boolean,
): string | undefined {
  const added = newCodeLines(file, view.workspace, view.base).filter(matches);
  if (added.length === 0) return undefined;
  const removed = removedAndNotReadded(file, view).filter(matches);
  if (added.length <= removed.length) return undefined;
  return added[0];
}

export function findSignalInAdded(
  files: DiffFile[],
  signals: string[],
  view: LineView = {},
): FindingEvidence | undefined {
  for (const file of files) {
    for (const signal of signals) {
      const hit = increasesMatchCount(file, view, (line) => containsIgnoreCase(line, signal));
      if (hit !== undefined) {
        return {
          kind: "violation_signal",
          detail: `added line contains \`${signal}\``,
          path: file.path,
          scope: "added_lines",
        };
      }
    }
  }
  return undefined;
}

export function findSignalGroup(
  files: DiffFile[],
  groups: string[][],
  view: LineView = {},
): FindingEvidence | undefined {
  for (const file of files) {
    const added = newCodeLines(file, view.workspace, view.base).join("\n");
    if (added.length === 0) continue;
    const removed = removedCodeLines(file, view.base).join("\n");
    for (const group of groups) {
      // Groups with fewer than two usable signals are rejected at load time.
      if (group.length < 2) continue;
      if (!group.every((signal) => containsIgnoreCase(added, signal))) continue;
      // If the whole combination was already present and merely moved, this
      // change did not create it.
      if (group.every((signal) => containsIgnoreCase(removed, signal))) continue;
      return {
        kind: "violation_signal_group",
        detail: `added lines contain the combined failure pattern: ${group.map((signal) => `\`${signal}\``).join(" + ")}`,
        path: file.path,
        scope: "added_lines",
      };
    }
  }
  return undefined;
}

export function findLinePattern(
  files: DiffFile[],
  patterns: string[],
  view: LineView = {},
): FindingEvidence | undefined {
  for (const file of files) {
    for (const source of patterns) {
      const hit = increasesMatchCount(file, view, (line) => lineMatches(source, line));
      if (hit !== undefined) {
        return {
          kind: "violation_line_pattern",
          detail: `added line matches \`${source}\``,
          path: file.path,
          scope: "added_lines",
        };
      }
    }
  }
  return undefined;
}

/**
 * Required guards must hold *together* in at least one scoped file.
 *
 * Joining every scoped file into one haystack would let guard A in one file and
 * guard B in another satisfy a rule whose whole point is that both appear at the
 * same decision site.
 */
export function missingRequiredSignals(
  bodies: Array<{ path: string; body: string }>,
  signals: string[],
): FindingEvidence | undefined {
  if (bodies.length === 0 || signals.length === 0) return undefined;
  // An empty scoped file says nothing about a guard. Judging it as a missing
  // guard turned a blank placeholder into a violation.
  const withContent = bodies.filter((file) => file.body.trim().length > 0);
  if (withContent.length === 0) return undefined;
  let closest: { path: string; missing: string[] } | undefined;
  for (const file of withContent) {
    const code = stripComments(file.body, file.path);
    const missing = signals.filter((signal) => !containsIgnoreCase(code, signal));
    if (missing.length === 0) return undefined;
    if (!closest || missing.length < closest.missing.length) {
      closest = { path: file.path, missing };
    }
  }
  const target = closest as { path: string; missing: string[] };
  return {
    kind: "guard_removed",
    detail: target.missing.length === 1
      ? `required guard \`${target.missing[0]}\` is not present in scoped files`
      : `required guards ${target.missing.map((signal) => `\`${signal}\``).join(" and ")} do not hold together in any scoped file`,
    path: target.path,
    scope: "workspace",
  };
}

/**
 * A guard token the change deleted and did not put back.
 *
 * Scoped per file: a token still present in some *other* changed file says
 * nothing about the file that lost it. Checked against the file's full
 * after-state when a checkout is available, so a guard that survives outside the
 * diff hunk is correctly seen as still present.
 */
export function findRemovedGuard(
  files: DiffFile[],
  tokens: string[],
  workspace?: Workspace,
  base?: Workspace,
): FindingEvidence | undefined {
  for (const file of files) {
    const removed = removedCodeLines(file, base).join("\n");
    if (removed.length === 0) continue;
    const surviving = stripComments(afterState(file, workspace), file.path);
    for (const token of tokens) {
      if (!containsIgnoreCase(removed, token)) continue;
      if (containsIgnoreCase(surviving, token)) continue;
      return {
        kind: "guard_removed",
        detail: `removed required guard \`${token}\` without a replacement in the file`,
        path: file.path,
        scope: "added_lines",
      };
    }
  }
  return undefined;
}

export function evidenceWithScope(
  evidence: FindingEvidence,
  scope: EvidenceScope,
): FindingEvidence {
  return { ...evidence, scope };
}
