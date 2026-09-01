import { minimatch } from "minimatch";
import { candidatePaths } from "./diff.ts";

const GLOB_OPTIONS = { dot: true, nocase: false };

export function matchesGlob(filePath: string, pattern: string): boolean {
  return candidatePaths(filePath).some((candidate) => minimatch(candidate, pattern, GLOB_OPTIONS));
}

export function matchesAnyGlob(filePath: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}

export function repoMatches(repositories: string[], repo: string): boolean {
  const needle = repo.trim().toLowerCase();
  return repositories.some((item) => {
    const value = item.trim().toLowerCase();
    return value === "*" || value === needle;
  });
}
