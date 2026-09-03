import { matchesAnyGlob, repoMatches } from "./glob.ts";
import { containsIgnoreCase } from "./text.ts";
import { stripSandboxPrefix } from "./diff.ts";
import type { CouplingGroup, MatchReason, ParsedDiff, Registry, Truth } from "./types.ts";

const TEST_EXCLUDES = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/tests/**",
];

export function isLive(truth: Truth): boolean {
  return truth.status === "live";
}

export function isVisibleGap(truth: Truth): boolean {
  return truth.status === "gap" || truth.status === "proposed";
}

export function pathExcluded(truth: Truth, filePath: string): boolean {
  const patterns = [
    ...(truth.applies_to.excluded_paths ?? []),
    ...(truth.executor.allowlist_paths ?? []),
    ...TEST_EXCLUDES,
  ];
  return matchesAnyGlob(filePath, patterns);
}

export function pathInScope(truth: Truth, filePath: string): boolean {
  if (pathExcluded(truth, filePath)) return false;
  const paths = truth.applies_to.paths;
  if (!paths || paths.length === 0) return true;
  return matchesAnyGlob(filePath, paths);
}

export function changedPaths(diff: ParsedDiff): string[] {
  return diff.files.map((file) => file.path);
}

function couplingHit(group: CouplingGroup, diff: ParsedDiff): boolean {
  // Files whose patch GitHub withheld carry a placeholder marker rather than
  // content; their lines are not evidence of anything.
  const withPatch = diff.files.filter((file) => file.patchAvailable);
  const haystack = [
    ...diff.files.map((file) => file.path),
    ...withPatch.flatMap((file) => file.allLines),
  ].join("\n");
  const pathHit = diff.files.some((file) =>
    matchesAnyGlob(stripSandboxPrefix(file.path), group.paths) || matchesAnyGlob(file.path, group.paths),
  );
  const markerHit = (group.markers ?? []).some((marker) => containsIgnoreCase(haystack, marker));
  return pathHit || markerHit;
}

export interface SelectedTruth {
  truth: Truth;
  reasons: MatchReason[];
}

export function selectTruths(registry: Registry, repo: string, diff: ParsedDiff): SelectedTruth[] {
  const selected: SelectedTruth[] = [];
  const liveCoupling = registry.coupling.filter((group) => couplingHit(group, diff));

  for (const truth of registry.truths) {
    if (!isLive(truth) && !isVisibleGap(truth)) continue;
    if (!repoMatches(truth.applies_to.repositories, repo)) continue;

    const reasons: MatchReason[] = [];
    if (truth.applies_to.always_on) reasons.push("always_on");

    const catalogHit = registry.surfaces.some(
      (surface) =>
        surface.always_on &&
        surface.truth_ids.includes(truth.id) &&
        repoMatches(surface.repositories, repo),
    );
    if (catalogHit) reasons.push("product_catalog");

    if (truth.executor.kind === "decision" || truth.applies_to.scan_workspace) {
      reasons.push("stale_decision_scan");
    }

    const scopedPaths = truth.applies_to.paths ?? [];
    const pathHit = scopedPaths.length > 0 && diff.files.some((file) => pathInScope(truth, file.path));
    if (pathHit) reasons.push("path");

    for (const group of liveCoupling) {
      if (group.truth_ids.includes(truth.id) || truth.applies_to.coupling?.includes(group.id)) {
        reasons.push(`coupling:${group.id}`);
      }
    }

    const unique = [...new Set(reasons)];
    if (unique.length === 0) continue;
    selected.push({ truth, reasons: unique });
  }

  return selected.sort((a, b) => a.truth.id.localeCompare(b.truth.id));
}
