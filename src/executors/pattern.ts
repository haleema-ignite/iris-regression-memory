import { cachedRegex, containsIgnoreCase, stripComments, lineMatches } from "../text.ts";
import {
  fail,
  findLinePattern,
  findRemovedGuard,
  findSignalGroup,
  findSignalInAdded,
  lineViewOf,
  missingRequiredSignals,
  pass,
  relevantDiffFiles,
  workspaceBodies,
  type ExecutorContext,
  type ExecutorResult,
} from "./common.ts";

export function runPattern(ctx: ExecutorContext): ExecutorResult {
  const { truth, diff, workspace } = ctx;
  const view = lineViewOf(ctx);
  const mode = truth.executor.mode ?? "both";
  const files = relevantDiffFiles(truth, diff);
  const checkAdded = mode === "added_lines" || mode === "both";
  const checkWorkspace = mode === "workspace" || mode === "both";

  if (checkAdded) {
    const signal = findSignalInAdded(files, truth.executor.forbidden_signals ?? [], view);
    if (signal) {
      return fail(`${truth.id} recreates a forbidden pattern.`, signal);
    }
    const group = findSignalGroup(files, truth.executor.forbidden_signal_groups ?? [], view);
    if (group) {
      return fail(`${truth.id} recreates a forbidden combined pattern.`, group);
    }
    const patterned = findLinePattern(files, truth.executor.forbidden_line_patterns ?? [], view);
    if (patterned) {
      return fail(`${truth.id} recreates a forbidden structural pattern.`, patterned);
    }
    const removed = findRemovedGuard(files, truth.executor.required_signals ?? [], workspace, ctx.baseWorkspace);
    if (removed) {
      return fail(`${truth.id} lost a required guard.`, removed);
    }
  }

  if (checkWorkspace) {
    const bodies = workspaceBodies(truth, workspace, files.map((file) => file.path));
    for (const file of bodies) {
      // Comments are not behaviour. A comment that names an anti-pattern in
      // order to warn about it must not read as a violation of it.
      const code = stripComments(file.body, file.path);
      for (const line of code.split("\n")) {
        for (const signal of truth.executor.forbidden_signals ?? []) {
          if (containsIgnoreCase(line, signal)) {
            return fail(`${truth.id} is violated in the workspace.`, {
              kind: "violation_signal",
              detail: `workspace line contains \`${signal}\``,
              path: file.path,
              scope: "workspace",
            });
          }
        }
        for (const source of truth.executor.forbidden_line_patterns ?? []) {
          if (lineMatches(source, line)) {
            return fail(`${truth.id} is violated in the workspace.`, {
              kind: "violation_line_pattern",
              detail: `workspace line matches \`${source}\``,
              path: file.path,
              scope: "workspace",
            });
          }
        }
      }
    }
    if (truth.executor.require_present) {
      const provingBodies = workspace.root
        ? bodies
        : bodies.filter((file) =>
          files.some((diffFile) => diffFile.path === file.path && diffFile.status === "added"),
        );
      const missing = missingRequiredSignals(provingBodies, truth.executor.required_signals ?? []);
      if (missing) {
        return fail(`${truth.id} is missing a required guard in scoped files.`, missing);
      }
    }
  }

  return pass(`${truth.id} holds. No forbidden pattern was added and required guards remain.`);
}
