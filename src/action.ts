import { appendFileSync, readFileSync } from "node:fs";
import { runAssessment } from "./cli.ts";
import {
  createCheckRun,
  upsertStickyComment,
} from "./github.ts";
import { checkConclusion, renderMarkdown } from "./report.ts";
import type { EnforcementMode } from "./report.ts";

interface PullRequestEvent {
  pull_request?: {
    number: number;
    head: { sha: string };
  };
  repository?: {
    full_name: string;
  };
}

async function main(): Promise<void> {
  const token = process.env.INPUT_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("The token input or GITHUB_TOKEN environment variable is required");
  }
  process.env.GITHUB_TOKEN = token;

  const eventPath = process.env.GITHUB_EVENT_PATH;
  const sourceRepo = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !sourceRepo) {
    throw new Error("GITHUB_EVENT_PATH and GITHUB_REPOSITORY are required");
  }

  const event = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent;
  const pr = event.pull_request?.number;
  const sha = event.pull_request?.head.sha ?? process.env.GITHUB_SHA;
  if (!pr || !sha) {
    throw new Error("This action only runs on pull_request events");
  }

  const targetRepo = process.env.INPUT_TARGET_REPOSITORY?.trim() ||
    process.env.REGRESSION_MEMORY_TARGET_REPOSITORY?.trim() ||
    sourceRepo;
  const enforcementValue = process.env.INPUT_ENFORCEMENT?.trim() ||
    process.env.REGRESSION_MEMORY_ENFORCEMENT?.trim() ||
    "warning";
  if (enforcementValue !== "warning" && enforcementValue !== "error") {
    throw new Error("enforcement must be warning or error");
  }
  const enforcement = enforcementValue as EnforcementMode;
  const shouldComment = (process.env.INPUT_COMMENT ?? process.env.REGRESSION_MEMORY_COMMENT ?? "true") !== "false";

  const assessment = await runAssessment({ repo: targetRepo, sourceRepo, pr });
  const body = renderMarkdown(assessment);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`, "utf8");
  }
  if (shouldComment) {
    await upsertStickyComment(sourceRepo, pr, body);
  }

  const conclusion = checkConclusion(assessment.verdict, enforcement, assessment.coverage.status);
  await createCheckRun({
    repo: sourceRepo,
    headSha: sha,
    name: "Behavioral Regression Memory",
    conclusion,
    title: `Behavioral regression: ${assessment.outcome.replaceAll("_", " ")}`,
    summary: body,
  });

  process.stdout.write(body);
  if (assessment.verdict === "fail" && enforcement === "error") {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
