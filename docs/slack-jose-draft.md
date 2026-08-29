# Slack draft — José + Seshi

**Channel:** DM José, cc Seshi (or `#ai-innovation-team` if they prefer it public)

---

José / Seshi — short proposal on behavioral regressions (IRISNG-3975-class: valid code, same failure mechanism).

CodeRabbit Pro cannot custom-check, and I do not want this to burn the 5 reviews/hour quota. I built a personal MVP as a GitHub Check instead:

https://github.com/haleema-ignite/iris-regression-memory

- Approved YAML contracts (Jira key + PR number only; no RCA dump)
- Fail only on path-matched evidence (violation signal or removed guard)
- Dogfood: engines #413 / #408 / #389 and iris-api #1112 replay **pass**; seeded mutation PRs in that repo **fail** with the contract ID

**Ask:** reusable Action, same pattern as iris-sp-engines Semgrep (`contents: read`, `pull-requests: write`), warning/neutral first, on iris-sp-engines then iris-api.

**Not asking:** Pro+ upgrade, CodeRabbit MCP, VPN hosting.

One-pager in the repo: `PROPOSAL.md`

---
