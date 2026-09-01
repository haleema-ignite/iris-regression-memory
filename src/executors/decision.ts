import { containsIgnoreCase } from "../text.ts";
import {
  fail,
  isAllowlisted,
  pass,
  relevantDiffFiles,
  type ExecutorContext,
  type ExecutorResult,
} from "./common.ts";

export function runDecision(ctx: ExecutorContext): ExecutorResult {
  const { truth, diff, workspace } = ctx;
  const tokens = truth.executor.leftover_tokens ?? [];
  if (tokens.length === 0) {
    return fail(`${truth.id} is misconfigured: a decision truth must name leftover tokens.`, {
      kind: "none",
      detail: "missing leftover_tokens",
    });
  }

  const scoped = truth.applies_to.paths ?? ["**/*"];
  const candidatePaths = new Set<string>([
    ...relevantDiffFiles(truth, diff).map((file) => file.path),
    ...workspace.list(scoped),
    ...(truth.executor.files ?? []),
  ]);

  for (const path of candidatePaths) {
    if (isAllowlisted(truth, path)) continue;
    const body = workspace.read(path);
    if (body === undefined) continue;
    for (const token of tokens) {
      if (containsIgnoreCase(body, token)) {
        return fail(
          `${truth.id}: leftover decision token \`${token}\` is still required or referenced.`,
          {
            kind: "stale_decision",
            detail: `found leftover \`${token}\``,
            path,
          },
        );
      }
    }
  }

  return pass(`${truth.id} holds. Leftover decision tokens are not required in scoped files.`);
}
