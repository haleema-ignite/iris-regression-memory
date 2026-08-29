# IRIS Behavioral Regression Memory

Personal MVP: **approved behavioral contracts** plus a GitHub-native assessor.
It answers: *does this PR reintroduce a failure mechanism that already caused a production incident?*

This repository is public and sanitized. Contracts cite **Jira keys** and **GitHub PR numbers** only. They do not include RCA prose, customer names, tokens, or internal hostnames.

It is **not** an org gate. It does not block `ignitetech-group/*`. CodeRabbit Pro cannot run custom pre-merge checks; this tool uses GitHub Checks instead so it does not consume CodeRabbit review quota.

## Assess a PR

```bash
npm install

# Historical replay (read-only, needs `gh auth` or GITHUB_TOKEN)
npm run assess -- --repo ignitetech-group/iris-sp-engines --pr 413
npm run assess -- --repo ignitetech-group/iris-api --pr 1112

# Local fixture
npm run assess -- --diff-file fixtures/positive/remove-dedup-key.diff --repo ignitetech-group/iris-sp-engines
```

Verdicts:

| Verdict | Meaning |
| --- | --- |
| **fail** | An **approved** contract matched the repo and a path/interface, and the diff either adds a listed `violation_signal` or removes a required guard. |
| **pass** | At least one contract applied, and none failed. |
| **inconclusive** | No path or interface anchor matched. Not a fail. |

Semantic similarity alone cannot fail. Unapproved contract statuses never fail.

## Layout

```text
contracts/schema.json
contracts/iris/*.yaml
fixtures/positive/*.diff
fixtures/negative/*.diff
fixtures/sandbox/                 # teaching snippets for seeded PRs
src/cli.ts
.github/workflows/assess.yml
PROPOSAL.md
```

## GitHub Action (this repo only)

On `pull_request`, the workflow fetches the head SHA diff, runs the same assessor, posts a sticky comment (`<!-- iris-regression-memory -->`), and creates a Check Run:

- `success` — pass
- `neutral` — inconclusive
- `failure` — seeded violation

Permissions match the org Semgrep shape: `contents: read`, `pull-requests: write`, plus `checks: write`.

## What this MVP does not include

- Incident extractors or internal knowledge-base search
- Vector indexes
- CodeRabbit custom checks or MCP
- Hosting on `*.ignitetech.ai`
- Auto-approval of contracts
- Blocking org repositories
