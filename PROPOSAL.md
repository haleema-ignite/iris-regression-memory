# Proposal: GitHub Check for IRIS behavioral regressions

**To:** José (CodeRabbit / GitHub org admin), Seshi (IRIS engines)
**From:** Haleema
**Repo:** https://github.com/haleema-ignite/iris-regression-memory

## Problem

CodeRabbit Pro cannot run **custom pre-merge checks**. Recurrences such as [IRISNG-3975](https://ignitetechpm.atlassian.net/browse/IRISNG-3975) are **behavioral**: the code compiles and the diff can look reasonable while still recreating a failure mechanism that already opened duplicate cases.

Dumping RCAs into a reviewer prompt is the wrong design. This MVP uses **approved, versioned contracts** and fails only on **direct evidence** (a listed violation signal in added lines, or a required guard removed from a path-matched file). Semantic similarity alone cannot fail.

## Demo

Public repo, MIT, sanitized contracts (Jira keys and GitHub PR numbers only).

1. **Historical pass** — Haleema-authored fixes replay as pass or inconclusive:
   - iris-sp-engines#413 (Facebook page auth isolation) → **pass** on IRIS-BEH-0004
   - iris-sp-engines#408 (Instagram DM profile names) → **pass** on IRIS-BEH-0005
   - iris-sp-engines#389 (mixed Meta webhook signatures) → **pass** on IRIS-BEH-0003
   - iris-api#1112 (companion Facebook credentials) → **pass** on IRIS-BEH-0004
2. **Seeded fail** — mutation PRs inside this personal repo that copy a snippet and remove the guard → **fail** with the matching contract ID, sticky PR comment, and Check Run `failure`.

CLI (read-only against any PR you can see):

```bash
npm run assess -- --repo ignitetech-group/iris-sp-engines --pr 413
```

## Ask

A **reusable GitHub Action**, same shape as [`iris-sp-engines/.github/workflows/semgrep.yml`](https://github.com/ignitetech-group/iris-sp-engines/blob/main/.github/workflows/semgrep.yml):

- `contents: read`, `pull-requests: write`, `checks: write`
- Warning / **neutral** first (inconclusive and pass do not block)
- Enable on `iris-sp-engines`, then `iris-api`
- Contracts stay reviewed and versioned; no auto-approval

The gate is **GitHub Checks**, so it does **not** consume CodeRabbit’s Pro quota (5 PR reviews per hour per developer).

## Not asking

- CodeRabbit Pro+ upgrade
- CodeRabbit MCP / custom pre-merge checks
- VPN or `*.ignitetech.ai` hosting
- Blocking `ignitetech-group/*` from this personal MVP

## Optional later

If the team wants CodeRabbit comments on top of the Check, expose a **public HTTPS** MCP (same pattern as existing public MCP endpoints). That is a follow-up, not a prerequisite.
