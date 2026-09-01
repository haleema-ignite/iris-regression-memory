import { containsIgnoreCase } from "../text.ts";
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

function queryWindows(body: string): string[] {
  return body.split(";").map((part) => part.trim()).filter(Boolean);
}

export function runContract(ctx: ExecutorContext): ExecutorResult {
  const { truth, diff, workspace } = ctx;
  const files = relevantDiffFiles(truth, diff);

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

  const bodies = workspaceBodies(truth, workspace, files.map((file) => file.path));
  const patterns = (truth.executor.forbidden_line_patterns ?? []).map((source) => ({
    source,
    expression: new RegExp(source, "i"),
  }));
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

    const anchor = truth.executor.query_anchor;
    const required = truth.executor.query_required;
    if (anchor && required) {
      for (const window of queryWindows(file.body)) {
        if (containsIgnoreCase(window, anchor) && containsIgnoreCase(window, "from") && !containsIgnoreCase(window, required)) {
          return fail(
            `${truth.id}: a query touching \`${anchor}\` does not mention \`${required}\`.`,
            {
              kind: "contract_broken",
              detail: `query window includes \`${anchor}\` without \`${required}\``,
              path: file.path,
            },
          );
        }
      }
    }
  }

  return pass(`${truth.id} holds. Writers still satisfy the contract.`);
}
