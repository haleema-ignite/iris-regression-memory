import { containsIgnoreCase } from "../text.ts";
import { afterStateFromDiff } from "../workspace.ts";
import {
  fail,
  findLinePattern,
  findRemovedGuard,
  findSignalInAdded,
  pass,
  relevantDiffFiles,
  workspaceBodies,
  type ExecutorContext,
  type ExecutorResult,
} from "./common.ts";
import type { FindingEvidence } from "../types.ts";

const WINDOW = 25;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findBareFromWithoutRequired(
  path: string,
  body: string,
  triggerLines: string[] | undefined,
  anchor: string,
  required: string,
  allowIf: string[],
): FindingEvidence | undefined {
  const fromTable = new RegExp(`\\bfrom\\s+${escapeRegExp(anchor)}\\b`, "i");
  const joinTable = new RegExp(`\\bjoin\\s+${escapeRegExp(anchor)}\\b`, "i");
  const lines = body.split("\n");
  const triggers = triggerLines
    ? new Set(triggerLines.filter((line) => fromTable.test(line) && !joinTable.test(line)))
    : undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!fromTable.test(line) || joinTable.test(line)) continue;
    if (triggers && !triggers.has(line) && !triggerLines?.some((added) => added === line)) continue;
    const window = lines.slice(Math.max(0, index - WINDOW), index + WINDOW + 1).join("\n");
    if (containsIgnoreCase(window, required)) continue;
    if (allowIf.some((token) => containsIgnoreCase(window, token))) continue;
    return {
      kind: "contract_broken",
      detail: `FROM ${anchor} without nearby \`${required}\``,
      path,
    };
  }
  return undefined;
}

export function runContract(ctx: ExecutorContext): ExecutorResult {
  const { truth, diff, workspace } = ctx;
  const mode = truth.executor.mode ?? "both";
  const checkAdded = mode === "added_lines" || mode === "both";
  const checkWorkspace = mode === "workspace" || mode === "both";
  const files = relevantDiffFiles(truth, diff);

  if (checkAdded) {
    const signal = findSignalInAdded(files, truth.executor.forbidden_signals ?? []);
    if (signal) {
      return fail(`${truth.id} breaks the recorded contract.`, {
        ...signal,
        kind: "contract_broken",
      });
    }
    const patterned = findLinePattern(files, truth.executor.forbidden_line_patterns ?? []);
    if (patterned) {
      return fail(`${truth.id} breaks the recorded contract.`, {
        ...patterned,
        kind: "contract_broken",
      });
    }
    const removed = findRemovedGuard(files, truth.executor.required_signals ?? []);
    if (removed) {
      return fail(`${truth.id} lost a required contract guard.`, removed);
    }
  }

  const bodies = checkWorkspace
    ? workspaceBodies(truth, workspace, files.map((file) => file.path))
    : files.map((file) => ({
      path: file.path,
      body: workspace.read(file.path) ?? afterStateFromDiff(file),
    }));

  const patterns = (truth.executor.forbidden_line_patterns ?? []).map((source) => ({
    source,
    expression: new RegExp(source, "i"),
  }));

  if (checkWorkspace) {
    for (const file of bodies) {
      for (const line of file.body.split("\n")) {
        for (const signalText of truth.executor.forbidden_signals ?? []) {
          if (containsIgnoreCase(line, signalText)) {
            return fail(`${truth.id} breaks the recorded contract in the workspace.`, {
              kind: "contract_broken",
              detail: `workspace line contains \`${signalText}\``,
              path: file.path,
            });
          }
        }
        for (const pattern of patterns) {
          if (pattern.expression.test(line)) {
            return fail(`${truth.id} breaks the recorded contract in the workspace.`, {
              kind: "contract_broken",
              detail: `workspace line matches \`${pattern.source}\``,
              path: file.path,
            });
          }
        }
      }
    }
  }

  const anchor = truth.executor.query_anchor;
  const required = truth.executor.query_required;
  if (anchor && required) {
    const allowIf = truth.executor.query_allow_if ?? [];
    for (const file of files.length > 0 ? files : []) {
      const body = workspace.read(file.path) ?? afterStateFromDiff(file);
      const evidence = findBareFromWithoutRequired(
        file.path,
        body,
        checkAdded && !checkWorkspace ? file.addedLines : undefined,
        anchor,
        required,
        allowIf,
      );
      if (evidence) {
        return fail(`${truth.id}: a live ${anchor} enumeration does not mention \`${required}\`.`, evidence);
      }
    }
  }

  return pass(`${truth.id} holds. Writers still satisfy the contract.`);
}
