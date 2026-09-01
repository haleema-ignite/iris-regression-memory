import { fail, type ExecutorContext, type ExecutorResult } from "./common.ts";
import { runContract } from "./contract.ts";
import { runDecision } from "./decision.ts";
import { runPattern } from "./pattern.ts";
import { runProduct } from "./product.ts";

export function runExecutor(ctx: ExecutorContext): ExecutorResult {
  switch (ctx.truth.executor.kind) {
    case "pattern":
    case "semgrep":
      return runPattern(ctx);
    case "product":
      return runProduct(ctx);
    case "contract":
      return runContract(ctx);
    case "decision":
      return runDecision(ctx);
    case "coderabbit":
      return {
        verdict: "pass",
        reason: `${ctx.truth.id} is delegated to CodeRabbit (${ctx.truth.executor.coderabbit_path ?? "path instruction"}). The compiler does not LLM-judge this class.`,
        evidence: {
          kind: "delegated",
          detail: ctx.truth.executor.coderabbit_instruction ?? "CodeRabbit path instruction",
        },
      };
    default: {
      const kind: never = ctx.truth.executor.kind;
      return fail(`Unknown executor ${String(kind)}`, {
        kind: "none",
        detail: "unknown executor",
      });
    }
  }
}
