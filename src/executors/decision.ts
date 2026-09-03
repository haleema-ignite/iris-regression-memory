import { cachedRegex, containsIgnoreCase, stripComments } from "../text.ts";
import {
  fail,
  isAllowlisted,
  isGeneratedPath,
  isScannableBody,
  pass,
  relevantDiffFiles,
  type ExecutorContext,
  type ExecutorResult,
} from "./common.ts";

export function runDecision(ctx: ExecutorContext): ExecutorResult {
  const { truth, diff, workspace } = ctx;
  const tokens = truth.executor.leftover_tokens ?? [];
  const patterns = truth.executor.leftover_patterns ?? [];
  if (tokens.length === 0 && patterns.length === 0) {
    return fail(`${truth.id} is misconfigured: a decision truth must name leftover tokens.`, {
      kind: "none",
      detail: "missing leftover_tokens and leftover_patterns",
      scope: "none",
    });
  }

  const scoped = truth.applies_to.paths ?? ["**/*"];
  const candidatePaths = new Set<string>([
    ...relevantDiffFiles(truth, diff).map((file) => file.path),
    ...workspace.list(scoped),
    ...(truth.executor.files ?? []),
  ]);

  for (const path of candidatePaths) {
    if (isAllowlisted(truth, path) || isGeneratedPath(path)) continue;
    const raw = workspace.read(path);
    if (raw === undefined || !isScannableBody(raw)) continue;
    // A leftover requirement is code, not a comment describing history.
    const body = stripComments(raw, path);
    for (const token of tokens) {
      if (containsIgnoreCase(body, token)) {
        return fail(
          `${truth.id}: leftover decision token \`${token}\` is still required or referenced.`,
          {
            kind: "stale_decision",
            detail: `found leftover \`${token}\``,
            path,
            scope: "workspace",
          },
        );
      }
    }
    for (const source of patterns) {
      if (cachedRegex(source).test(body)) {
        return fail(
          `${truth.id}: a leftover decision requirement matching \`${source}\` is still present.`,
          {
            kind: "stale_decision",
            detail: `found leftover matching \`${source}\``,
            path,
            scope: "workspace",
          },
        );
      }
    }
  }

  return pass(`${truth.id} holds. Leftover decision tokens are not required in scoped files.`);
}
