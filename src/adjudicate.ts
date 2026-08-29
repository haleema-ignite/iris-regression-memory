import { containsIgnoreCase, pathMatches } from "./retrieve.ts";
import type { RetrievalHit } from "./retrieve.ts";
import type { BehavioralContract, DiffFile, Finding, FindingEvidence, ParsedDiff } from "./types.ts";

const FAILABLE_STATUSES = new Set(["approved"]);

function relevantFiles(contract: BehavioralContract, diff: ParsedDiff): DiffFile[] {
  const matched = diff.files.filter((file) => pathMatches(contract, file.path));
  return matched.length > 0 ? matched : [];
}

function addedHaystack(files: DiffFile[]): string {
  return files.flatMap((file) => file.addedLines).join("\n");
}

function findViolationSignal(
  contract: BehavioralContract,
  files: DiffFile[],
): FindingEvidence | undefined {
  const signals = contract.applicability.violation_signals ?? [];
  for (const file of files) {
    for (const line of file.addedLines) {
      for (const signal of signals) {
        if (containsIgnoreCase(line, signal)) {
          return {
            kind: "violation_signal",
            detail: `added line contains \`${signal}\``,
            path: file.path,
          };
        }
      }
    }
  }
  return undefined;
}

function guardTokens(contract: BehavioralContract): string[] {
  return (contract.scope.symbols ?? []).filter((token) => token.trim().length > 3);
}

function findRemovedGuard(
  contract: BehavioralContract,
  files: DiffFile[],
): FindingEvidence | undefined {
  const tokens = guardTokens(contract);
  const added = addedHaystack(files);

  for (const file of files) {
    for (const token of tokens) {
      const removedHit = file.removedLines.some((line) => containsIgnoreCase(line, token));
      const stillAdded = containsIgnoreCase(added, token);
      const stillInFile = file.addedLines.some((line) => containsIgnoreCase(line, token)) ||
        file.allLines.some(
          (line) =>
            !file.removedLines.includes(line) &&
            containsIgnoreCase(line, token) &&
            !file.addedLines.includes(line),
        );

      if (removedHit && !stillAdded && !stillInFile) {
        return {
          kind: "guard_removed",
          detail: `removed \`${token}\` without a replacement in the diff`,
          path: file.path,
        };
      }
    }
  }
  return undefined;
}

export function adjudicate(hit: RetrievalHit, diff: ParsedDiff): Finding {
  const { contract, score } = hit;
  const base = {
    contractId: contract.id,
    title: contract.title,
    requiredGuards: contract.required_guards,
    references: contract.incident.references,
    score,
  };

  if (!FAILABLE_STATUSES.has(contract.status)) {
    return {
      ...base,
      verdict: "pass",
      reason: `Contract status is \`${contract.status}\`; only approved contracts can fail.`,
      evidence: { kind: "none", detail: "status gate" },
    };
  }

  const files = relevantFiles(contract, diff);
  if (files.length === 0) {
    return {
      ...base,
      verdict: "pass",
      reason: "Interface mention without a path-matched file; not a fail.",
      evidence: { kind: "none", detail: "no path-matched files" },
    };
  }

  const violation = findViolationSignal(contract, files);
  if (violation) {
    return {
      ...base,
      verdict: "fail",
      reason: `Diff recreates the historical failure mechanism for ${contract.id}.`,
      evidence: violation,
    };
  }

  const removed = findRemovedGuard(contract, files);
  if (removed) {
    return {
      ...base,
      verdict: "fail",
      reason: `A required guard for ${contract.id} was removed.`,
      evidence: removed,
    };
  }

  return {
    ...base,
    verdict: "pass",
    reason: `Applies to this change, but the required guards remain and no violation signal was added.`,
    evidence: { kind: "none", detail: "applicable without violation" },
  };
}

export function findingsFromHits(hits: RetrievalHit[], diff: ParsedDiff): Finding[] {
  return hits.map((hit) => adjudicate(hit, diff));
}
