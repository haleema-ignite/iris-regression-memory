import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createFsWorkspace } from "./workspace.ts";
import type { Workspace } from "./types.ts";

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    out: (result.stdout ?? "").trim(),
  };
}

/** The commit a checkout is currently at, or undefined if it is not a git tree. */
export function checkoutSha(root: string): string | undefined {
  const result = git(root, ["rev-parse", "HEAD"]);
  return result.ok ? result.out : undefined;
}

/** Whether a checkout has uncommitted changes. A dirty tree is not a revision. */
export function checkoutDirty(root: string): boolean | undefined {
  const result = git(root, ["status", "--porcelain"]);
  if (!result.ok) return undefined;
  return result.out.length > 0;
}

export function resolveRef(root: string, ref: string): string | undefined {
  const result = git(root, ["rev-parse", `${ref}^{commit}`]);
  return result.ok ? result.out : undefined;
}

export interface MaterializedBaseline {
  workspace: Workspace;
  sha: string;
  dispose(): void;
}

/**
 * Materialize `ref` from the git checkout at `root` into a temporary directory.
 *
 * Attribution needs the state before the change. Reading it out of the working
 * tree is not an option — that is the head state — so the base is extracted
 * with `git archive`, exactly as the historical evaluator does.
 */
export function materializeBaseline(root: string, ref: string): MaterializedBaseline {
  const sha = resolveRef(root, ref);
  if (!sha) {
    throw new Error(
      `--base-ref \`${ref}\` could not be resolved in ${root}. ` +
      "Pass a ref that exists in that checkout, or omit it to run without attribution.",
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "truth-compiler-base-"));
  const archive = spawnSync("git", ["-C", root, "archive", sha], {
    encoding: "buffer",
    maxBuffer: 400 * 1024 * 1024,
  });
  if (archive.error || archive.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`git archive ${sha} failed in ${root}`);
  }
  const extracted = spawnSync("tar", ["-x", "-C", dir], {
    input: archive.stdout,
    encoding: "buffer",
    maxBuffer: 400 * 1024 * 1024,
  });
  if (extracted.error || extracted.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`extracting the base tree for ${sha} failed`);
  }
  return {
    workspace: createFsWorkspace(dir),
    sha,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
