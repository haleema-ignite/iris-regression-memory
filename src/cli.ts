import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assess } from "./assess.ts";
import { writeCompileResult } from "./compile.ts";
import { filesToUnifiedDiff, parseUnifiedDiff } from "./diff.ts";
import { fetchPullRequest, fetchPullRequestFiles } from "./github.ts";
import { loadRegistry } from "./registry.ts";
import { renderMarkdown } from "./report.ts";
import type { EnforcementMode } from "./report.ts";
import { renderSarif } from "./sarif.ts";
import type { Assessment } from "./types.ts";
import { createFsWorkspace } from "./workspace.ts";

export type OutputFormat = "markdown" | "json" | "sarif";

export interface CliOptions {
  command?: "assess" | "compile" | "list";
  tenant?: string;
  repo?: string;
  sourceRepo?: string;
  pr?: number;
  diffFile?: string;
  workspace?: string;
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
  npx truth-compiler assess --tenant iris --repo owner/name --pr 413
  npx truth-compiler assess --tenant iris --repo owner/name --diff-file change.diff --workspace ../iris-web
  npx truth-compiler compile --tenant iris --out tenants/iris/emitters
  npx truth-compiler list --tenant iris

Options:
  --tenant NAME       Tenant id (default: iris)
  --repo owner/name   GitHub repository (required for assess)
  --source-repo NAME  Repository from which to fetch the PR diff
  --pr N              Pull request number
  --diff-file PATH    Local unified diff instead of GitHub
  --workspace DIR     Checkout to prove product, decision, and workspace facts
  --format FORMAT     markdown (default), json, or sarif
  --enforcement MODE  warning (exit 0) or error (exit 1 on a failed blocking truth)
  --out DIR           Compile emitters to this directory
`);
}

export async function runAssessment(options: CliOptions): Promise<Assessment> {
  if (!options.repo) {
    throw new Error("--repo owner/name is required");
  }
  if (!options.pr && !options.diffFile) {
    throw new Error("Provide --pr or --diff-file");
  }

  const registry = loadRegistry(options.tenant ?? "iris");
  const workspace = options.workspace ? createFsWorkspace(resolve(options.workspace)) : undefined;

  if (options.diffFile) {
    const raw = readFileSync(options.diffFile, "utf8");
    return assess({
      repo: options.repo,
      diff: parseUnifiedDiff(raw),
      source: options.diffFile,
      registry,
      workspace,
    });
  }

  const sourceRepo = options.sourceRepo ?? options.repo;
  const meta = await fetchPullRequest(sourceRepo, options.pr!);
  const files = await fetchPullRequestFiles(sourceRepo, options.pr!);
  const raw = filesToUnifiedDiff(files);
  return assess({
    repo: options.repo,
    diff: parseUnifiedDiff(raw),
    sha: meta.headSha,
    pr: meta.number,
    source: `${sourceRepo}#${meta.number}@${meta.headSha.slice(0, 7)}`,
    registry,
    workspace,
  });
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
    const enforcement = options.enforcement ?? "error";
    if (assessment.verdict === "fail" && enforcement !== "warning") {
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
