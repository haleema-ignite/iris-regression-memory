import { containsIgnoreCase, stripComments, lineMatches } from "../text.ts";
import {
  afterState,
  fail,
  findLinePattern,
  findRemovedGuard,
  findSignalInAdded,
  lineViewOf,
  newCodeLines,
  pass,
  relevantDiffFiles,
  workspaceBodies,
  type ExecutorContext,
  type ExecutorResult,
} from "./common.ts";
import type { FindingEvidence } from "../types.ts";

/**
 * Upper bound on how far the enclosing block may reach before we stop expanding.
 * A safety valve; the real boundary is a blank line.
 */
const MAX_BLOCK_LINES = 40;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The contiguous block of code around `index`, bounded by blank lines.
 *
 * A fixed ±N-line window was wrong: it reached across blank lines into
 * unrelated neighbouring queries, so a query that mentioned `int_deleted`
 * twenty lines away could satisfy the requirement for one that did not.
 *
 * Scoping to a single `;`-terminated statement is wrong in the other direction.
 * These filters are routinely composed across several statements:
 *
 *   const where = ["int_com_id = ?"];
 *   where.push("int_deleted = 0");
 *   const sql = `SELECT id FROM int_integration WHERE ${where.join(" AND ")}`;
 *
 * The filter is real, and it is on a different statement from the anchor.
 * A blank-line-bounded block keeps a query builder together while still
 * refusing to reach into the next one.
 */
function enclosingBlock(lines: string[], index: number): string {
  let start = index;
  while (start > 0 && index - start < MAX_BLOCK_LINES) {
    if ((lines[start - 1] ?? "").trim().length === 0) break;
    start -= 1;
  }
  let end = index;
  while (end < lines.length - 1 && end - index < MAX_BLOCK_LINES) {
    if ((lines[end + 1] ?? "").trim().length === 0) break;
    end += 1;
  }
  return lines.slice(start, end + 1).join("\n");
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
  const lines = stripComments(body, path).split("\n");
  const triggers = triggerLines
    ? new Set(
      triggerLines
        .filter((line) => fromTable.test(line) && !joinTable.test(line))
        .map((line) => line.replace(/\s+/g, " ").trim()),
    )
    : undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!fromTable.test(line) || joinTable.test(line)) continue;
    if (triggers && !triggers.has(line.replace(/\s+/g, " ").trim())) continue;
    const statement = enclosingBlock(lines, index);
    if (containsIgnoreCase(statement, required)) continue;
    if (allowIf.some((token) => containsIgnoreCase(statement, token))) continue;
    return {
      kind: "contract_broken",
      detail: `FROM ${anchor} without \`${required}\` in the same block`,
      path,
      scope: triggerLines ? "added_lines" : "workspace",
    };
  }
  return undefined;
}

export function runContract(ctx: ExecutorContext): ExecutorResult {
  const { truth, diff, workspace } = ctx;
  const view = lineViewOf(ctx);
  const mode = truth.executor.mode ?? "both";
  const checkAdded = mode === "added_lines" || mode === "both";
  const checkWorkspace = mode === "workspace" || mode === "both";
  const files = relevantDiffFiles(truth, diff);

  if (checkAdded) {
    const signal = findSignalInAdded(files, truth.executor.forbidden_signals ?? [], view);
    if (signal) {
      return fail(`${truth.id} breaks the recorded contract.`, {
        ...signal,
        kind: "contract_broken",
      });
    }
    const patterned = findLinePattern(files, truth.executor.forbidden_line_patterns ?? [], view);
    if (patterned) {
      return fail(`${truth.id} breaks the recorded contract.`, {
        ...patterned,
        kind: "contract_broken",
      });
    }
    const removed = findRemovedGuard(files, truth.executor.required_signals ?? [], workspace, ctx.baseWorkspace);
    if (removed) {
      return fail(`${truth.id} lost a required contract guard.`, removed);
    }
  }

  if (checkWorkspace) {
    const bodies = workspaceBodies(truth, workspace, files.map((file) => file.path));
    for (const file of bodies) {
      const code = stripComments(file.body, file.path);
      for (const line of code.split("\n")) {
        for (const signalText of truth.executor.forbidden_signals ?? []) {
          if (containsIgnoreCase(line, signalText)) {
            return fail(`${truth.id} breaks the recorded contract in the workspace.`, {
              kind: "contract_broken",
              detail: `workspace line contains \`${signalText}\``,
              path: file.path,
              scope: "workspace",
            });
          }
        }
        for (const source of truth.executor.forbidden_line_patterns ?? []) {
          if (lineMatches(source, line)) {
            return fail(`${truth.id} breaks the recorded contract in the workspace.`, {
              kind: "contract_broken",
              detail: `workspace line matches \`${source}\``,
              path: file.path,
              scope: "workspace",
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
    if (checkWorkspace) {
      // Ratchet: adjudicate every scoped enumeration in the checkout.
      for (const file of workspaceBodies(truth, workspace, files.map((item) => item.path))) {
        const evidence = findBareFromWithoutRequired(
          file.path,
          file.body,
          undefined,
          anchor,
          required,
          allowIf,
        );
        if (evidence) {
          return fail(`${truth.id}: a live ${anchor} enumeration does not mention \`${required}\`.`, evidence);
        }
      }
    } else {
      // Reintroduction: only adjudicate enumerations this change added.
      for (const file of files) {
        const evidence = findBareFromWithoutRequired(
          file.path,
          afterState(file, workspace),
          // Added lines resolved by line number against the same
          // comment-stripped body these triggers are matched against, so the
          // two views cannot disagree. This also applies the removed/added
          // pairing, so reindenting an existing non-compliant query is no
          // longer reported as a newly added one.
          newCodeLines(file, workspace, ctx.baseWorkspace),
          anchor,
          required,
          allowIf,
        );
        if (evidence) {
          return fail(`${truth.id}: a live ${anchor} enumeration does not mention \`${required}\`.`, evidence);
        }
      }
    }
  }

  return pass(`${truth.id} holds. Writers still satisfy the contract.`);
}
