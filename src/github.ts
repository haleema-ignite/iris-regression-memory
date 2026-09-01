import { execFileSync } from "node:child_process";

export interface PullRequestMeta {
  number: number;
  title: string;
  headSha: string;
  baseSha: string;
  htmlUrl: string;
}

export interface PullRequestFile {
  filename: string;
  status: string;
  patch?: string | null;
}

interface GitHubPull {
  number: number;
  title: string;
  html_url: string;
  head: { sha: string };
  base: { sha: string };
}

function resolveToken(): string | undefined {
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GH_TOKEN?.trim()) return process.env.GH_TOKEN.trim();
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

async function githubFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = resolveToken();
  if (!token) {
    throw new Error("No GitHub token. Set GITHUB_TOKEN or authenticate with `gh auth login`.");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "truth-compiler",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} ${path}: ${body.slice(0, 500)}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchPullRequest(repo: string, pr: number): Promise<PullRequestMeta> {
  const data = await githubFetch<GitHubPull>(`/repos/${repo}/pulls/${pr}`);
  return {
    number: data.number,
    title: data.title,
    headSha: data.head.sha,
    baseSha: data.base.sha,
    htmlUrl: data.html_url,
  };
}

export async function fetchPullRequestFiles(repo: string, pr: number): Promise<PullRequestFile[]> {
  const files: PullRequestFile[] = [];
  let page = 1;
  while (page <= 10) {
    const batch = await githubFetch<PullRequestFile[]>(
      `/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) break;
    if (page === 10) {
      throw new Error("Pull request has more than 1,000 changed files; GitHub diff pagination is incomplete.");
    }
    page += 1;
  }
  return files;
}

export async function fetchIssueComments(
  repo: string,
  pr: number,
): Promise<Array<{ id: number; body?: string }>> {
  return githubFetch(`/repos/${repo}/issues/${pr}/comments?per_page=100`);
}

export async function createIssueComment(repo: string, pr: number, body: string): Promise<void> {
  await githubFetch(`/repos/${repo}/issues/${pr}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export async function updateIssueComment(repo: string, commentId: number, body: string): Promise<void> {
  await githubFetch(`/repos/${repo}/issues/comments/${commentId}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export async function upsertStickyComment(
  repo: string,
  pr: number,
  body: string,
  marker = "<!-- truth-compiler -->",
): Promise<void> {
  const comments = await fetchIssueComments(repo, pr);
  const existing = comments.find((comment) =>
    comment.body?.includes(marker) || comment.body?.includes("<!-- iris-regression-memory -->"),
  );
  if (existing) {
    await updateIssueComment(repo, existing.id, body);
    return;
  }
  await createIssueComment(repo, pr, body);
}

export async function createCheckRun(input: {
  repo: string;
  headSha: string;
  name: string;
  conclusion: "success" | "neutral" | "failure";
  title: string;
  summary: string;
}): Promise<void> {
  await githubFetch(`/repos/${input.repo}/check-runs`, {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      head_sha: input.headSha,
      status: "completed",
      conclusion: input.conclusion,
      output: {
        title: input.title,
        summary: input.summary.slice(0, 65000),
      },
    }),
  });
}
