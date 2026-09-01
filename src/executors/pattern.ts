import { containsIgnoreCase } from "../text.ts";
import {
  fail,
  findLinePattern,
  findRemovedGuard,
  findSignalGroup,
  findSignalInAdded,
  pass,
  relevantDiffFiles,
  workspaceBodies,
  type ExecutorContext,
  type ExecutorResult,
} from "./common.ts";

export function runPattern(ctx: ExecutorContext): ExecutorResult {
  const { truth, diff, workspace } = ctx;
  const mode = truth.executor.mode ?? "both";
  const files = relevantDiffFiles(truth, diff);
  const checkAdded = mode === "added_lines" || mode === "both";
  const checkWorkspace = mode === "workspace" || mode === "both";

  if (checkAdded) {
    const signal = findSignalInAdded(files, truth.executor.forbidden_signals ?? []);
    if (signal) {
      return fail(`${truth.id} recreates a forbidden pattern.`, signal);
    }
    const group = findSignalGroup(files, truth.executor.forbidden_signal_groups ?? []);
    if (group) {
      return fail(`${truth.id} recreates a forbidden combined pattern.`, group);
    }
    const patterned = findLinePattern(files, truth.executor.forbidden_line_patterns ?? []);
    if (patterned) {
      return fail(`${truth.id} recreates a forbidden structural pattern.`, patterned);
    }
    const removed = findRemovedGuard(files, truth.executor.required_signals ?? []);
    if (removed) {
      return fail(`${truth.id} lost a required guard.`, removed);
    }
  }

  if (checkWorkspace) {
    const bodies = workspaceBodies(truth, workspace, files.map((file) => file.path));
    const patterns = (truth.executor.forbidden_line_patterns ?? []).map((source) => ({
      source,
      expression: new RegExp(source, "i"),
    }));
    for (const file of bodies) {
      for (const line of file.body.split("\n")) {
        for (const signal of truth.executor.forbidden_signals ?? []) {
          if (containsIgnoreCase(line, signal)) {
            return fail(`${truth.id} is violated in the workspace.`, {
              kind: "violation_signal",
              detail: `workspace line contains \`${signal}\``,
              path: file.path,
            });
          }
        }
        for (const pattern of patterns) {
          if (pattern.expression.test(line)) {
            return fail(`${truth.id} is violated in the workspace.`, {
              kind: "violation_line_pattern",
              detail: `workspace line matches \`${pattern.source}\``,
              path: file.path,
            });
          }
        }
      }
    }
  }

  return pass(`${truth.id} holds. No forbidden pattern was added and required guards remain.`);
}
