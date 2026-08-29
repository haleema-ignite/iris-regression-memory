import { readFileSync } from "node:fs";
import { assess } from "./assess.ts";
import { loadContracts } from "./contracts.ts";
import { filesToUnifiedDiff, parseUnifiedDiff } from "./diff.ts";
import { fetchPullRequest, fetchPullRequestFiles } from "./github.ts";
import { renderMarkdown } from "./report.ts";
import type { EnforcementMode } from "./report.ts";
import { renderSarif } from "./sarif.ts";
import type { Assessment } from "./types.ts";

export type OutputFormat = "markdown" | "json" | "sarif";

export interface CliOptions {
  repo?: string;
  sourceRepo?: string;
  pr?: number;
  diffFile?: string;
  format?: OutputFormat;
  enforcement?: EnforcementMode;
  contractsDir?: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--repo" && next) {
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
    } else if (arg === "--contracts-dir" && next) {
      options.contractsDir = next;
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`Usage:
  npm run assess -- --repo owner/name --pr 413
  npm run assess -- --diff-file fixtures/positive/remove-dedup-key.diff --repo owner/name

Options:
  --repo owner/name   GitHub repository (required)
  --source-repo NAME  Repository from which to fetch the PR diff (defaults to --repo)
  --pr N              Pull request number (fetches the head SHA diff)
  --diff-file PATH    Local unified diff instead of GitHub
  --format FORMAT     markdown (default), json, or sarif
  --json              Alias for --format json
  --sarif             Alias for --format sarif
  --enforcement MODE  warning (exit 0) or error (exit 1 on a detected regression)
  --contracts-dir DIR Load contracts from a custom directory
`);
}

export async function runAssessment(options: CliOptions): Promise<Assessment> {
  if (!options.repo) {
    throw new Error("--repo owner/name is required");
  }
  if (!options.pr && !options.diffFile) {
    throw new Error("Provide --pr or --diff-file");
  }

  const contracts = loadContracts(options.contractsDir);

  if (options.diffFile) {
    const raw = readFileSync(options.diffFile, "utf8");
    return assess({
      repo: options.repo,
      diff: parseUnifiedDiff(raw),
      source: options.diffFile,
      contracts,
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
    contracts,
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseArgs(argv);
    const assessment = await runAssessment(options);
    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
    } else if (options.format === "sarif") {
      process.stdout.write(`${JSON.stringify(renderSarif(assessment), null, 2)}\n`);
    } else {
      process.stdout.write(renderMarkdown(assessment));
    }
    if (assessment.verdict === "fail" && options.enforcement !== "warning") {
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
