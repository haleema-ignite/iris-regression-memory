import { lstatSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { matchesAnyGlob } from "./glob.ts";
import type { DiffFile, ParsedDiff, Workspace } from "./types.ts";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".rulesync",
  ".worktrees",
  "_ticket-worktrees",
  ".cursor",
  "coverage",
]);

function walkFiles(root: string, acc: string[] = [], current = root): string[] {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(current, entry);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(root, acc, full);
    } else if (st.isFile()) {
      acc.push(relative(root, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

export function createFsWorkspace(root: string): Workspace {
  const resolved = root;
  if (!existsSync(resolved)) {
    throw new Error(`Workspace \`${root}\` does not exist`);
  }
  let cached: string[] | undefined;
  return {
    root: resolved,
    read(relPath: string) {
      const full = join(resolved, relPath);
      try {
        const st = lstatSync(full);
        if (st.isSymbolicLink() || st.isDirectory()) return undefined;
        return readFileSync(full, "utf8");
      } catch {
        return undefined;
      }
    },
    list(patterns: string[]) {
      cached ??= walkFiles(resolved);
      if (patterns.length === 0) return cached;
      return cached.filter((path) => matchesAnyGlob(path, patterns));
    },
  };
}

export function afterStateFromDiff(file: DiffFile): string {
  if (file.status === "deleted") return "";
  return [...file.contextLines, ...file.addedLines].join("\n");
}

export function createDiffWorkspace(diff: ParsedDiff): Workspace {
  const files = new Map(diff.files.map((file) => [file.path.replace(/\\/g, "/"), file]));
  return {
    read(relPath: string) {
      const file = files.get(relPath.replace(/\\/g, "/"));
      if (!file) return undefined;
      return afterStateFromDiff(file);
    },
    list(patterns: string[]) {
      const paths = [...files.keys()];
      if (patterns.length === 0) return paths;
      return paths.filter((path) => matchesAnyGlob(path, patterns));
    },
  };
}

export function overlayWorkspace(primary: Workspace | undefined, fallback: Workspace): Workspace {
  if (!primary) return fallback;
  return {
    root: primary.root ?? fallback.root,
    read(relPath: string) {
      const fromPrimary = primary.read(relPath);
      if (fromPrimary !== undefined) return fromPrimary;
      return fallback.read(relPath);
    },
    list(patterns: string[]) {
      return [...new Set([...primary.list(patterns), ...fallback.list(patterns)])].sort();
    },
  };
}
