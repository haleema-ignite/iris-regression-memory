import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assess } from "./assess.ts";
import { writeCompileResult } from "./compile.ts";
import { filesToUnifiedDiff, parseUnifiedDiff } from "./diff.ts";
import { fetchPullRequest, fetchPullRequestFiles } from "./github.ts";
import { detectDefaultBase, isGitCheckout, localCheckoutDiff } from "./local-git.ts";
import { assertKnownRepository, loadRegistry } from "./registry.ts";
import { renderMarkdown } from "./report.ts";
import type { EnforcementMode } from "./report.ts";
import { renderSarif } from "./sarif.ts";
import type { Assessment } from "./types.ts";
import { createFsWorkspace } from "./workspace.ts";
import { checkoutDirty, checkoutSha, materializeBaseline } from "./baseline.ts";

export type OutputFormat = "markdown" | "json" | "sarif";

export interface CliOptions {
  command?: "assess" | "compile" | "list";
  tenant?: string;
  repo?: string;
  sourceRepo?: string;
  pr?: number;
  diffFile?: string;
  workspace?: string;
  /** Diff base for the local-checkout mode. Defaults to main/master. */
  base?: string;
  /** Diff head for the local-checkout mode. Defaults to the working tree. */
  head?: string;
  /** Assess the checkout only, with no diff at all. */
  noDiff?: boolean;
  /** Attribution base. Defaults to `base` in local mode. */
  baseRef?: string;
  baseWorkspace?: string;
  allowRevisionMismatch?: boolean;
  format?: OutputFormat;
  enforcement?: EnforcementMode;
  outDir?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  const rest = [...argv];
  if (rest[0] === "assess" || rest[0] === "compile" || rest[0] === "list") {
    options.command = rest.shift() as CliOptions["command"];
  }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === "--tenant" && next) {
      options.tenant = next;
      i += 1;
    } else if (arg === "--repo" && next) {
      options.repo = next;
      i += 1;
    } else if (arg === "--source-repo" && next) {
      options.sourceRepo = next;
      i += 1;
    } else if (arg === "--pr" && next) {
      options.pr = Number(next);
      i += 1;
    } else if (arg === "--diff-file" && next) {
      options.diffFile = next;
      i += 1;
    } else if (arg === "--workspace" && next) {
      options.workspace = next;
      i += 1;
    } else if (arg === "--base" && next) {
      options.base = next;
      i += 1;
    } else if (arg === "--head" && next) {
      options.head = next;
      i += 1;
    } else if (arg === "--no-diff") {
      options.noDiff = true;
    } else if (arg === "--base-ref" && next) {
      options.baseRef = next;
      i += 1;
    } else if (arg === "--base-workspace" && next) {
      options.baseWorkspace = next;
      i += 1;
    } else if (arg === "--allow-revision-mismatch") {
      options.allowRevisionMismatch = true;
    } else if (arg === "--json") {
      options.format = "json";
    } else if (arg === "--sarif") {
      options.format = "sarif";
    } else if (arg === "--format" && next && ["markdown", "json", "sarif"].includes(next)) {
      options.format = next as OutputFormat;
      i += 1;
    } else if (arg === "--enforcement" && next && ["warning", "error"].includes(next)) {
      options.enforcement = next as EnforcementMode;
      i += 1;
    } else if (arg === "--out" && next) {
      options.outDir = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  if (!options.command) {
    options.command = options.outDir && !options.repo && !options.pr && !options.diffFile
      ? "compile"
      : "assess";
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`Usage:
  npx truth-compiler assess --tenant iris --repo owner/name --workspace ../iris-web
  npx truth-compiler assess --tenant iris --repo owner/name --diff-file change.diff --workspace ../iris-web
  npx truth-compiler assess --tenant iris --repo owner/name --pr 413 --workspace ../iris-web
  npx truth-compiler compile --tenant iris --out tenants/iris/emitters
  npx truth-compiler list --tenant iris

The team trial is local. Pass --workspace so product, leftover-decision, and require_present facts run. GitHub --pr is optional.

Options:
  --tenant NAME       Tenant id (default: iris)
  --repo owner/name   GitHub repository, must be declared in tenant.yaml (required)
  --source-repo NAME  Repository from which to fetch the PR diff
  --pr N              Pull request number (needs a token; not required for the
                      local trial)
  --diff-file PATH    Local unified diff instead of git or GitHub
  --workspace DIR     Checkout used to prove product, decision, and workspace
                      facts (required for assess)
  --base REF          Diff base (default: main/master). With --workspace and no
                      --diff-file, diffs the working tree against this ref, and
                      is also used as the attribution base
  --head REF          Diff head (default: working tree). Three-dot base...head
                      when set to a commit
  --no-diff           Assess the checkout only. Every failure is pre-existing by
                      definition, because there is no change to attribute one to
  --base-ref REF      Attribution base, if it differs from --base. Materialized
                      from --workspace. Without a base state, workspace failures
                      are reported as unknown rather than blamed on this change
  --base-workspace DIR  An already-materialized base checkout, instead of --base-ref
  --allow-revision-mismatch
                      Proceed when --workspace is not at the pull request head.
                      Conclusions are then labelled unverified.
  --format FORMAT     markdown (default), json, or sarif
  --enforcement MODE  warning (exit 0, default) or error (exit 1 only for a
                      blocking truth this change introduced; a pre-existing
                      ratchet is reported and stays exit 0)
  --out DIR           Compile emitters to this directory
`);
}

export async function runAssessment(options: CliOptions): Promise<Assessment> {
  if (!options.repo) {
    throw new Error("--repo owner/name is required");
  }
  // Product, decision and workspace-mode truths read the checkout. Without one,
  // a file is reconstructed from hunk context alone, which is not the file — so
  // an assessment could report a surface as missing because it was merely
  // outside the diff. Refuse rather than produce that.
  if (!options.workspace) {
    throw new Error(
      "--workspace DIR is required. Product, decision and workspace-mode truths " +
      "must be proved against a checkout, not against a diff. For the local trial " +
      "this is the IRIS service checkout itself.",
    );
  }

  const registry = loadRegistry(options.tenant ?? "iris");
  assertKnownRepository(registry, options.repo);
  const workspaceRoot = resolve(options.workspace);
  const workspace = createFsWorkspace(workspaceRoot);
  const workspaceSha = checkoutSha(workspaceRoot);
  const dirty = checkoutDirty(workspaceRoot);

  // Auditing the checkout with no diff at all. There is no change here, so
  // every failure is pre-existing by definition; using the checkout as its own
  // base says exactly that rather than reporting attribution as unknown.
  if (options.noDiff) {
    return assess({
      repo: options.repo,
      diff: parseUnifiedDiff(""),
      source: `checkout:${workspaceRoot}`,
      registry,
      workspace,
      baseWorkspace: workspace,
      revision: {
        verified: dirty === false,
        workspaceSha,
        ...(dirty === false
          ? {}
          : { note: "the checkout has uncommitted changes, so it is not a revision" }),
      },
    });
  }

  // Which ref to materialize as the state before the change. In local mode the
  // diff base is the obvious answer, so the trial gets attribution for free.
  const attributionRef = options.baseRef
    ?? (options.diffFile || options.pr ? undefined : options.base ?? defaultBaseOf(workspaceRoot));

  const baseline = options.baseWorkspace
    ? {
      workspace: createFsWorkspace(resolve(options.baseWorkspace)),
      sha: undefined as string | undefined,
      dispose: () => {},
    }
    : attributionRef
      ? materializeBaseline(workspaceRoot, attributionRef)
      : undefined;

  try {
    if (options.diffFile) {
      const raw = readFileSync(options.diffFile, "utf8");
      return assess({
        repo: options.repo,
        diff: parseUnifiedDiff(raw),
        source: options.diffFile,
        registry,
        workspace,
        baseWorkspace: baseline?.workspace,
        // A local diff carries no revision, so we cannot confirm it describes
        // this checkout. Saying so is the only honest option: a diff that
        // deletes a control, assessed against a checkout that still has it,
        // otherwise produces a confident and wrong pass.
        revision: {
          verified: false,
          workspaceSha,
          baseSha: baseline?.sha,
          note: "a local diff file cannot be tied to this checkout; " +
            "workspace conclusions are unverified",
        },
      });
    }

    if (options.pr) {
      const sourceRepo = options.sourceRepo ?? options.repo;
      const meta = await fetchPullRequest(sourceRepo, options.pr);
      const files = await fetchPullRequestFiles(sourceRepo, options.pr);
      const raw = filesToUnifiedDiff(files);
      const matches = workspaceSha === meta.headSha;
      if (!matches && !options.allowRevisionMismatch) {
        throw new Error(
          `--workspace ${workspaceRoot} is at ${workspaceSha ?? "an unknown revision"}, ` +
          `but ${sourceRepo}#${meta.number} has head ${meta.headSha}. ` +
          "Assessing a pull request diff against a different checkout produces confident " +
          "and wrong answers: check out the head, or pass --allow-revision-mismatch to " +
          "proceed with the result labelled unverified.",
        );
      }
      if (matches && dirty && !options.allowRevisionMismatch) {
        throw new Error(
          `--workspace ${workspaceRoot} is at the pull request head but has uncommitted ` +
          "changes, so it is not that revision. Stash them, or pass " +
          "--allow-revision-mismatch to proceed with the result labelled unverified.",
        );
      }
      return assess({
        repo: options.repo,
        diff: parseUnifiedDiff(raw),
        sha: meta.headSha,
        pr: meta.number,
        source: `${sourceRepo}#${meta.number}@${meta.headSha.slice(0, 7)}`,
        registry,
        workspace,
        baseWorkspace: baseline?.workspace,
        revision: {
          verified: matches && dirty === false,
          workspaceSha,
          expectedSha: meta.headSha,
          baseSha: baseline?.sha,
          ...(matches && dirty === false
            ? {}
            : {
              note: dirty
                ? "the checkout has uncommitted changes"
                : "the checkout is not at the pull request head",
            }),
        },
      });
    }

    // Local trial: diff the working tree against its base. The diff and the
    // checkout are the same thing here, so the revision is self-consistent by
    // construction — a clean tree makes it a named revision too.
    const raw = localCheckoutDiff(workspaceRoot, options.base, options.head);
    return assess({
      repo: options.repo,
      diff: parseUnifiedDiff(raw),
      source: `local:${workspaceRoot}`,
      registry,
      workspace,
      baseWorkspace: baseline?.workspace,
      revision: {
        verified: true,
        workspaceSha,
        baseSha: baseline?.sha,
        ...(dirty
          ? { note: "working tree has uncommitted changes, which is expected for a local trial" }
          : {}),
      },
    });
  } finally {
    baseline?.dispose();
  }
}

/**
 * The ref a local checkout should be diffed and attributed against, or
 * undefined when it cannot be determined. A missing base is not fatal: it only
 * means failures are reported as unattributed rather than blamed on this change.
 */
function defaultBaseOf(root: string): string | undefined {
  if (!isGitCheckout(root)) return undefined;
  try {
    return detectDefaultBase(root);
  } catch {
    return undefined;
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseArgs(argv);
    const tenant = options.tenant ?? "iris";

    if (options.command === "list") {
      const registry = loadRegistry(tenant);
      const rows = registry.truths.map((truth) => ({
        id: truth.id,
        status: truth.status,
        executor: truth.executor.kind,
        blocking: truth.executor.blocking,
        title: truth.title,
      }));
      process.stdout.write(`${JSON.stringify({ tenant: registry.tenant, truths: rows }, null, 2)}\n`);
      return;
    }

    if (options.command === "compile") {
      const registry = loadRegistry(tenant);
      const outDir = resolve(options.outDir ?? `tenants/${tenant}/emitters`);
      mkdirSync(outDir, { recursive: true });
      const compiled = writeCompileResult(registry, outDir);
      process.stdout.write(`Wrote Semgrep and CodeRabbit emitters for ${compiled.tenant} to ${outDir}\n`);
      return;
    }

    const assessment = await runAssessment(options);
    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
    } else if (options.format === "sarif") {
      process.stdout.write(`${JSON.stringify(renderSarif(assessment), null, 2)}\n`);
    } else {
      process.stdout.write(renderMarkdown(assessment));
    }
    // The trial is warning-only: a failed truth must not break anyone's loop
    // until the registry has been validated against live pull requests.
    //
    // Even under `error`, only what this change introduced exits nonzero. A
    // pre-existing ratchet is reported and stays exit 0, matching the Action.
    const enforcement = options.enforcement ?? "warning";
    if (assessment.outcome === "fact_failed" && enforcement !== "warning") {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1]?.includes("cli.ts") ||
  process.argv[1]?.endsWith("/cli.js") ||
  process.argv[1]?.endsWith("/cli.mjs") ||
  process.argv[1]?.endsWith("/cli.cjs");
if (invoked) {
  void main();
}
