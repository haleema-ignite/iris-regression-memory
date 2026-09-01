import { matchesAnyGlob } from "../glob.ts";
import { pathExcluded, pathInScope } from "../match.ts";
import { containsIgnoreCase } from "../text.ts";
import { afterStateFromDiff } from "../workspace.ts";
import type {
  DiffFile,
  FindingEvidence,
  ParsedDiff,
  Truth,
  Workspace,
} from "../types.ts";

export interface ExecutorContext {
  truth: Truth;
  diff: ParsedDiff;
  workspace: Workspace;
  repo: string;
}

export interface ExecutorResult {
  verdict: "pass" | "fail";
  reason: string;
  evidence: FindingEvidence;
}

export function pass(detail: string): ExecutorResult {
  return {
    verdict: "pass",
    reason: detail,
    evidence: { kind: "none", detail },
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

export function workspaceBodies(truth: Truth, workspace: Workspace, extraPaths: string[] = []): Array<{ path: string; body: string }> {
  const requested = [
    ...(truth.executor.files ?? []),
    ...extraPaths,
  ];
  const fromList = requested.length > 0
    ? requested
    : workspace.list(truth.applies_to.paths ?? ["**/*"]);
  const seen = new Set<string>();
  const out: Array<{ path: string; body: string }> = [];
  for (const path of fromList) {
    if (seen.has(path) || isAllowlisted(truth, path)) continue;
    seen.add(path);
    const body = workspace.read(path);
    if (body === undefined) continue;
    out.push({ path, body });
  }
  return out;
}

export function addedAndWorkspaceHaystacks(
  truth: Truth,
  diff: ParsedDiff,
  workspace: Workspace,
): Array<{ path: string; added: string; current: string }> {
  const files = relevantDiffFiles(truth, diff);
  return files.map((file) => ({
    path: file.path,
    added: file.addedLines.join("\n"),
    current: workspace.read(file.path) ?? afterStateFromDiff(file),
  }));
}

export function findSignalInAdded(
  files: DiffFile[],
  signals: string[],
): FindingEvidence | undefined {
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

export function findSignalGroup(files: DiffFile[], groups: string[][]): FindingEvidence | undefined {
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

export function findLinePattern(files: DiffFile[], patterns: string[]): FindingEvidence | undefined {
  const compiled = patterns.map((source) => ({ source, expression: new RegExp(source, "i") }));
  for (const file of files) {
    for (const line of file.addedLines) {
      for (const pattern of compiled) {
        if (pattern.expression.test(line)) {
          return {
            kind: "violation_line_pattern",
            detail: `added line matches \`${pattern.source}\``,
            path: file.path,
          };
        }
      }
    }
  }
  return undefined;
}

export function missingRequiredSignals(
  bodies: Array<{ path: string; body: string }>,
  signals: string[],
): FindingEvidence | undefined {
  if (bodies.length === 0 || signals.length === 0) return undefined;
  const haystack = bodies.map((file) => file.body).join("\n");
  for (const signal of signals) {
    if (!containsIgnoreCase(haystack, signal)) {
      return {
        kind: "guard_removed",
        detail: `required guard \`${signal}\` is not present in scoped files`,
        path: bodies[0]?.path,
      };
    }
  }
  return undefined;
}

export function findRemovedGuard(files: DiffFile[], tokens: string[]): FindingEvidence | undefined {
  const current = files.flatMap((file) => [...file.contextLines, ...file.addedLines]).join("\n");
  for (const file of files) {
    for (const token of tokens) {
      const removedHit = file.removedLines.some((line) => containsIgnoreCase(line, token));
      const stillPresent = containsIgnoreCase(current, token);
      if (removedHit && !stillPresent) {
        return {
          kind: "guard_removed",
          detail: `removed required guard \`${token}\` without a replacement in the diff`,
          path: file.path,
        };
      }
    }
  }
  return undefined;
}
