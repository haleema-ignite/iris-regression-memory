import { cachedRegex, containsIgnoreCase, stripComments } from "../text.ts";
import { fail, pass, type ExecutorContext, type ExecutorResult } from "./common.ts";

export function runProduct(ctx: ExecutorContext): ExecutorResult {
  const { truth, workspace } = ctx;
  const files = truth.executor.files ?? [];
  if (files.length === 0) {
    return fail(`${truth.id} is misconfigured: a product truth must name files.`, {
      kind: "none",
      detail: "missing executor.files",
      scope: "none",
    });
  }

  const missingFiles: string[] = [];
  for (const relPath of files) {
    const raw = workspace.read(relPath);
    if (raw === undefined) {
      missingFiles.push(relPath);
      continue;
    }
    // Match against code only. A product surface that survives solely as a
    // comment is not a product surface: leaving `{/* Generate Campaign */}`
    // behind after deleting the control must not read as the control existing.
    const body = stripComments(raw, relPath);

    for (const needle of truth.executor.must_contain ?? []) {
      if (!containsIgnoreCase(body, needle)) {
        return fail(`${truth.id}: \`${relPath}\` no longer contains \`${needle}\` outside comments.`, {
          kind: "product_missing",
          detail: `required product text \`${needle}\` is missing`,
          path: relPath,
          scope: "workspace",
        });
      }
    }

    for (const source of truth.executor.must_contain_patterns ?? []) {
      if (!cachedRegex(source).test(body)) {
        return fail(`${truth.id}: \`${relPath}\` no longer matches \`${source}\`.`, {
          kind: "product_missing",
          detail: `required product structure \`${source}\` is missing`,
          path: relPath,
          scope: "workspace",
        });
      }
    }

    const anyOf = truth.executor.must_contain_any ?? [];
    if (anyOf.length > 0 && !anyOf.some((needle) => containsIgnoreCase(body, needle))) {
      return fail(
        `${truth.id}: \`${relPath}\` contains none of ${anyOf.map((needle) => `\`${needle}\``).join(", ")}.`,
        {
          kind: "product_missing",
          detail: `none of the required alternatives is present: ${anyOf.join(", ")}`,
          path: relPath,
          scope: "workspace",
        },
      );
    }

    for (const needle of truth.executor.must_not_contain ?? []) {
      if (containsIgnoreCase(body, needle)) {
        return fail(`${truth.id}: \`${relPath}\` contains forbidden \`${needle}\`.`, {
          kind: "product_missing",
          detail: `forbidden product text \`${needle}\` is present`,
          path: relPath,
          scope: "workspace",
        });
      }
    }
  }

  if (missingFiles.length > 0) {
    if (!workspace.root) {
      // Reachable only through a programmatic caller: the CLI requires a
      // checkout precisely so a product truth is never adjudicated from a diff.
      throw new Error(
        `${truth.id} is a product truth and cannot be adjudicated without a checkout. ` +
        `Missing files: ${missingFiles.join(", ")}. Pass a workspace.`,
      );
    }
    return fail(`${truth.id}: required product files are gone.`, {
      kind: "product_missing",
      detail: `missing files: ${missingFiles.join(", ")}`,
      path: missingFiles[0],
      scope: "workspace",
    });
  }

  return pass(`${truth.id} holds. Required product text is still present outside comments.`);
}
