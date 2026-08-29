import { readFileSync } from "node:fs";
import { runAssessment } from "./cli.ts";
import {
  createCheckRun,
  upsertStickyComment,
} from "./github.ts";
import { checkConclusion, renderMarkdown } from "./report.ts";

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
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!eventPath || !repo) {
    throw new Error("GITHUB_EVENT_PATH and GITHUB_REPOSITORY are required");
  }

  const event = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestEvent;
  const pr = event.pull_request?.number;
  const sha = event.pull_request?.head.sha ?? process.env.GITHUB_SHA;
  if (!pr || !sha) {
    throw new Error("This action only runs on pull_request events");
  }

  const assessment = await runAssessment({ repo, pr });
  const body = renderMarkdown(assessment);
  await upsertStickyComment(repo, pr, body);

  const conclusion = checkConclusion(assessment.verdict);
  await createCheckRun({
    repo,
    headSha: sha,
    name: "IRIS Behavioral Regression",
    conclusion,
    title: `Behavioral regression: ${assessment.verdict.toUpperCase()}`,
    summary: body,
  });

  process.stdout.write(body);
  if (assessment.verdict === "fail") {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
