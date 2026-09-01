import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";

const DEFAULT_BASES = ["main", "master", "origin/main", "origin/master"];

function git(cwd: string, args: string[], options: SpawnSyncOptions = {}) {
  return spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
}

export function isGitCheckout(root: string): boolean {
  return existsSync(join(root, ".git"));
}

export function detectDefaultBase(root: string): string {
  for (const name of DEFAULT_BASES) {
    const result = git(root, ["rev-parse", "--verify", "--quiet", name]);
    if (result.status === 0) return name;
  }
  throw new Error(`Could not find main/master in \`${root}\`. Pass --base.`);
}

export function localCheckoutDiff(root: string, base?: string, head?: string): string {
  if (!isGitCheckout(root)) return "";
  const resolvedBase = base ?? detectDefaultBase(root);
  const args = ["diff", "--no-ext-diff", "--unified=3"];
  if (head && head !== "HEAD") {
    args.push(`${resolvedBase}...${head}`);
  } else {
    args.push(resolvedBase);
  }
  const result = git(root, args);
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || "").trim();
    throw new Error(`git diff failed in \`${root}\`: ${err}`);
  }
  return String(result.stdout ?? "");
}
