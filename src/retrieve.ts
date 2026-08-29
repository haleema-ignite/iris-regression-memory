import { minimatch } from "minimatch";
import { candidatePaths } from "./diff.ts";
import type { BehavioralContract, ParsedDiff } from "./types.ts";

const GLOB_OPTIONS = { dot: true, nocase: false };

export function repoMatches(contract: BehavioralContract, repo: string): boolean {
  const needle = repo.trim().toLowerCase();
  return contract.scope.repositories.some((item) => item.toLowerCase() === needle);
}

export function pathMatches(contract: BehavioralContract, filePath: string): boolean {
  return candidatePaths(filePath).some((candidate) =>
    contract.scope.paths.some((pattern) => minimatch(candidate, pattern, GLOB_OPTIONS)),
  );
}

export function collectHaystack(diff: ParsedDiff): string {
  return diff.files
    .flatMap((file) => [file.path, ...file.allLines, ...file.addedLines, ...file.removedLines])
    .join("\n");
}

export function interfaceHits(contract: BehavioralContract, haystack: string): string[] {
  const needles = [
    ...(contract.scope.interfaces?.kafka_topics ?? []),
    ...(contract.scope.interfaces?.configuration_keys ?? []),
  ].filter((item) => item.trim().length > 0);

  return needles.filter((needle) => containsIgnoreCase(haystack, needle));
}

export function anchorHits(contract: BehavioralContract, haystack: string): string[] {
  const needles = [
    ...(contract.scope.symbols ?? []),
    ...contract.applicability.strong_anchors,
  ].filter((item) => item.trim().length > 0);

  return needles.filter((needle) => containsIgnoreCase(haystack, needle));
}

export function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export interface RetrievalHit {
  contract: BehavioralContract;
  score: number;
  pathMatched: boolean;
  interfaceMatched: boolean;
  hits: string[];
}

export function retrieve(
  contracts: BehavioralContract[],
  repo: string,
  diff: ParsedDiff,
  limit = 3,
): RetrievalHit[] {
  const haystack = collectHaystack(diff);
  const hits: RetrievalHit[] = [];

  for (const contract of contracts) {
    if (!repoMatches(contract, repo)) {
      continue;
    }

    const pathMatched = diff.files.some((file) => pathMatches(contract, file.path));
    const interfaceMatched = interfaceHits(contract, haystack).length > 0;
    const hitsFound = [...new Set([...interfaceHits(contract, haystack), ...anchorHits(contract, haystack)])];

    if (!pathMatched && !interfaceMatched) {
      continue;
    }

    const score =
      (pathMatched ? 10 : 0) +
      (interfaceMatched ? 5 : 0) +
      hitsFound.length +
      (contract.status === "approved" ? 1 : 0);

    hits.push({
      contract,
      score,
      pathMatched,
      interfaceMatched,
      hits: hitsFound,
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.contract.id.localeCompare(b.contract.id)).slice(0, limit);
}
