import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";

/**
 * Remote-tracking refs first, deliberately.
 *
 * A local `main` is whatever the developer last pulled, and all four IRIS
 * checkouts currently have a local `main` that differs from its
 * remote-tracking ref. Preferring the local one made results
 * machine-dependent: the same branch assessed differently on two laptops.
 */
const DEFAULT_BASES = ["origin/main", "origin/master", "main", "master"];

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[], options: SpawnSyncOptions = {}): GitResult {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

export function isGitCheckout(root: string): boolean {
  return existsSync(join(root, ".git"));
}

export interface ResolvedBase {
  ref: string;
  sha: string;
  /** True when the ref chosen was a local branch rather than a remote one. */
  local: boolean;
}

/**
 * The base to diff and attribute against, with the SHA it resolved to.
 *
 * Returning the SHA is the point: a base ref name alone does not identify a
 * revision, and a runner that prints only "vs main/master" cannot be
 * reproduced by anyone else.
 */
export function detectDefaultBase(root: string): ResolvedBase {
  for (const ref of DEFAULT_BASES) {
    const resolved = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (resolved.status === 0) {
      return { ref, sha: resolved.stdout.trim(), local: !ref.startsWith("origin/") };
    }
  }
  throw new Error(
    `Could not find any of ${DEFAULT_BASES.join(", ")} in \`${root}\`. Pass --base explicitly.`,
  );
}

export function resolveBase(root: string, base?: string): ResolvedBase {
  if (!base) return detectDefaultBase(root);
  const resolved = git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (resolved.status !== 0) {
    throw new Error(`--base \`${base}\` could not be resolved in \`${root}\`.`);
  }
  return { ref: base, sha: resolved.stdout.trim(), local: !base.startsWith("origin/") };
}

/**
 * Resolve the common ancestor a pull-request-style comparison is actually
 * based on.
 *
 * GitHub's `base.sha` is the current tip of the target branch. It is not
 * necessarily the commit the feature branch diverged from: the target branch
 * may have advanced after the PR was opened. Attribution must therefore use
 * the merge base of base and head, not the base tip itself.
 */
export function resolveMergeBase(
  root: string,
  base: string,
  head: string,
): string | undefined {
  const result = git(root, ["merge-base", base, head]);
  if (result.status !== 0) return undefined;
  const sha = result.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : undefined;
}

export interface WorktreeStatus {
  modified: number;
  untracked: string[];
}

/** What is uncommitted in the working tree, so a report can say so. */
export function worktreeStatus(root: string): WorktreeStatus {
  const tracked = git(root, ["status", "--porcelain", "--untracked-files=no"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]);
  return {
    modified: tracked.status === 0
      ? tracked.stdout.split("\n").filter((line: string) => line.trim().length > 0).length
      : 0,
    untracked: untracked.status === 0
      ? untracked.stdout.split("\n").filter((line: string) => line.trim().length > 0)
      : [],
  };
}

export interface LocalDiff {
  diff: string;
  base: ResolvedBase;
  /** The merge base actually diffed from, which is what a pull request shows. */
  mergeBase: string;
  untrackedIncluded: string[];
}

/**
 * A unified diff of the working tree (or `head`) against its merge base.
 *
 * Two corrections over a plain `git diff <base>`:
 *
 *   - It diffs from the *merge base*, which is what a pull request shows.
 *     Diffing against the base tip attributes every commit that landed on the
 *     base since the branch started to this branch.
 *   - Untracked files are included as additions when asked for. A runner that
 *     says it assesses uncommitted work and then silently ignores new files is
 *     claiming coverage it does not have — and a brand-new file is exactly
 *     where a fresh violation lives.
 */
export function localCheckoutDiff(
  root: string,
  options: { base?: string; head?: string; includeUntracked?: boolean } = {},
): LocalDiff {
  if (!isGitCheckout(root)) {
    throw new Error(`\`${root}\` is not a git checkout, so there is no diff to take.`);
  }
  const base = resolveBase(root, options.base);
  const head = options.head && options.head !== "HEAD" ? options.head : undefined;

  const mergeBase = resolveMergeBase(root, base.sha, head ?? "HEAD") ?? base.sha;

  const args = ["diff", "--no-ext-diff", "--unified=3", mergeBase];
  if (head) args.push(head);
  const result = git(root, args);
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout).trim();
    throw new Error(`git diff failed in \`${root}\`: ${message}`);
  }

  let diff = result.stdout;
  const untrackedIncluded: string[] = [];
  if (options.includeUntracked && !head) {
    for (const path of worktreeStatus(root).untracked) {
      // `git diff --no-index` against /dev/null renders a new file as an
      // addition, which is what the assessor needs to see.
      const rendered = git(root, [
        "diff", "--no-ext-diff", "--unified=3", "--no-index", "--", "/dev/null", path,
      ]);
      // --no-index exits 1 when files differ, which is the normal case here.
      const body = rendered.stdout;
      if (body.trim().length > 0) {
        diff += (diff.endsWith("\n") || diff.length === 0 ? "" : "\n") + body;
        untrackedIncluded.push(path);
      }
    }
  }

  return { diff, base, mergeBase, untrackedIncluded };
}
