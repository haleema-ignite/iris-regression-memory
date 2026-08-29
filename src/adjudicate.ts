import { containsIgnoreCase, pathExcluded, pathMatches } from "./retrieve.ts";
import type { RetrievalHit } from "./retrieve.ts";
import type { BehavioralContract, DiffFile, Finding, FindingEvidence, ParsedDiff } from "./types.ts";

const FAILABLE_STATUSES = new Set(["approved"]);

function relevantFiles(contract: BehavioralContract, diff: ParsedDiff): DiffFile[] {
  const matched = diff.files.filter(
    (file) => pathMatches(contract, file.path) && !pathExcluded(contract, file.path),
  );
  return matched.length > 0 ? matched : [];
}

function currentHaystack(files: DiffFile[]): string {
  return files.flatMap((file) => [...file.contextLines, ...file.addedLines]).join("\n");
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

function findViolationSignalGroup(
  contract: BehavioralContract,
  files: DiffFile[],
): FindingEvidence | undefined {
  const groups = contract.applicability.violation_signal_groups ?? [];
  for (const file of files) {
    const added = file.addedLines.join("\n");
    for (const group of groups) {
      const normalized = group.filter((signal) => signal.trim().length > 1);
      if (normalized.length < 2) continue;
      if (normalized.every((signal) => containsIgnoreCase(added, signal))) {
        return {
          kind: "violation_signal_group",
          detail: `added lines contain the combined failure pattern: ${normalized.map((signal) => `\`${signal}\``).join(" + ")}`,
          path: file.path,
        };
      }
    }
  }
  return undefined;
}

function findViolationLinePattern(
  contract: BehavioralContract,
  files: DiffFile[],
): FindingEvidence | undefined {
  const patterns = (contract.applicability.violation_line_patterns ?? []).map((source) => ({
    source,
    expression: new RegExp(source, "i"),
  }));
  for (const file of files) {
    for (const line of file.addedLines) {
      for (const pattern of patterns) {
        if (pattern.expression.test(line)) {
          return {
            kind: "violation_line_pattern",
            detail: `added line matches the structural failure pattern \`${pattern.source}\``,
            path: file.path,
          };
        }
      }
    }
  }
  return undefined;
}

function removalSignals(contract: BehavioralContract): string[] {
  return (contract.applicability.removal_signals ?? []).filter(
    (signal) => signal.trim().length > 3,
  );
}

function findRemovedGuard(
  contract: BehavioralContract,
  files: DiffFile[],
): FindingEvidence | undefined {
  const tokens = removalSignals(contract);
  const current = currentHaystack(files);

  for (const file of files) {
    for (const token of tokens) {
      const removedHit = file.removedLines.some((line) => containsIgnoreCase(line, token));
      const stillPresent = containsIgnoreCase(current, token);

      if (removedHit && !stillPresent) {
        return {
          kind: "guard_removed",
          detail: `removed historical guard signal \`${token}\` without a replacement in the diff`,
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

  const groupedViolation = findViolationSignalGroup(contract, files);
  if (groupedViolation) {
    return {
      ...base,
      verdict: "fail",
      reason: `Diff recreates the historical failure mechanism for ${contract.id}.`,
      evidence: groupedViolation,
    };
  }

  const patternedViolation = findViolationLinePattern(contract, files);
  if (patternedViolation) {
    return {
      ...base,
      verdict: "fail",
      reason: `Diff recreates the historical failure mechanism for ${contract.id}.`,
      evidence: patternedViolation,
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
