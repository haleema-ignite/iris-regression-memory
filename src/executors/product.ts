import { containsIgnoreCase } from "../text.ts";
import { fail, pass, type ExecutorContext, type ExecutorResult } from "./common.ts";

export function runProduct(ctx: ExecutorContext): ExecutorResult {
  const { truth, workspace } = ctx;
  const files = truth.executor.files ?? [];
  if (files.length === 0) {
    return fail(`${truth.id} is misconfigured: a product truth must name files.`, {
      kind: "none",
      detail: "missing executor.files",
    });
  }

  const missingFiles: string[] = [];
  for (const relPath of files) {
    const body = workspace.read(relPath);
    if (body === undefined) {
      missingFiles.push(relPath);
      continue;
    }
    for (const needle of truth.executor.must_contain ?? []) {
      if (!containsIgnoreCase(body, needle)) {
        return fail(`${truth.id}: \`${relPath}\` no longer contains \`${needle}\`.`, {
          kind: "product_missing",
          detail: `required product text \`${needle}\` is missing`,
          path: relPath,
        });
      }
    }
    for (const needle of truth.executor.must_not_contain ?? []) {
      if (containsIgnoreCase(body, needle)) {
        return fail(`${truth.id}: \`${relPath}\` contains forbidden \`${needle}\`.`, {
          kind: "product_missing",
          detail: `forbidden product text \`${needle}\` is present`,
          path: relPath,
        });
      }
    }
  }

  if (missingFiles.length > 0) {
    if (!workspace.root) {
      return fail(
        `${truth.id} is a blocking product truth and needs a checkout to prove the surface still exists.`,
        {
          kind: "workspace_required",
          detail: `missing files without a workspace: ${missingFiles.join(", ")}`,
          path: missingFiles[0],
        },
      );
    }
    return fail(`${truth.id}: required product files are gone.`, {
      kind: "product_missing",
      detail: `missing files: ${missingFiles.join(", ")}`,
      path: missingFiles[0],
    });
  }

  return pass(`${truth.id} holds. Required product text is still present.`);
}
