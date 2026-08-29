import { readFileSync } from "node:fs";
import { assess } from "./assess.ts";
import { loadContracts } from "./contracts.ts";
import { filesToUnifiedDiff, parseUnifiedDiff } from "./diff.ts";
import { fetchPullRequest, fetchPullRequestFiles } from "./github.ts";
import { renderMarkdown } from "./report.ts";
import type { Assessment } from "./types.ts";

export interface CliOptions {
  repo?: string;
  pr?: number;
  diffFile?: string;
  json?: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--repo" && next) {
      options.repo = next;
      i += 1;
    } else if (arg === "--pr" && next) {
      options.pr = Number(next);
      i += 1;
    } else if (arg === "--diff-file" && next) {
      options.diffFile = next;
      i += 1;
    } else if (arg === "--json") {
      options.json = true;
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
  --pr N              Pull request number (fetches the head SHA diff)
  --diff-file PATH    Local unified diff instead of GitHub
  --json              Print JSON instead of markdown
`);
}

export async function runAssessment(options: CliOptions): Promise<Assessment> {
  if (!options.repo) {
    throw new Error("--repo owner/name is required");
  }
  if (!options.pr && !options.diffFile) {
    throw new Error("Provide --pr or --diff-file");
  }

  const contracts = loadContracts();

  if (options.diffFile) {
    const raw = readFileSync(options.diffFile, "utf8");
    return assess({
      repo: options.repo,
      diff: parseUnifiedDiff(raw),
      source: options.diffFile,
      contracts,
    });
  }

  const meta = await fetchPullRequest(options.repo, options.pr!);
  const files = await fetchPullRequestFiles(options.repo, options.pr!);
  const raw = filesToUnifiedDiff(files);
  return assess({
    repo: options.repo,
    diff: parseUnifiedDiff(raw),
    sha: meta.headSha,
    pr: meta.number,
    source: `${options.repo}#${meta.number}@${meta.headSha.slice(0, 7)}`,
    contracts,
  });
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseArgs(argv);
    const assessment = await runAssessment(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
    } else {
      process.stdout.write(renderMarkdown(assessment));
    }
    if (assessment.verdict === "fail") {
      process.exitCode = 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const invoked = process.argv[1]?.includes("cli.ts") || process.argv[1]?.endsWith("/cli.js");
if (invoked) {
  void main();
}
