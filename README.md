# IRIS Regression Memory

IRIS Regression Memory is a deterministic review layer for behavior that is valid code but unsafe in context. It turns resolved production incidents into small, approved contracts and checks pull-request diffs for the exact failure mechanisms that caused them.

The repository is public-safe by design. Contracts contain issue keys, pull-request numbers, technical invariants, paths, and guard signals. They must not contain customer data, copied incident conversations, credentials, internal hostnames, or personal attribution.

## Safety model

A finding is reported only when all of these are true:

1. The contract is `approved`.
2. The target repository matches the contract.
3. A changed production path matches the contract and is not excluded.
4. An added line contains an explicit `violation_signal`, or the diff removes an explicit `removal_signal` without a replacement.

Similarity, keywords outside the scoped paths, and retrieval rank cannot fail a review. A change with no applicable contract is `inconclusive`, never `pass`. Partial path coverage is displayed explicitly.

## Run it

```bash
npm ci

# A GitHub pull request. Requires GITHUB_TOKEN, GH_TOKEN, or authenticated gh.
npm run assess -- --repo ignitetech-group/iris-sp-engines --pr 413

# A local unified diff.
npm run assess -- \
  --repo ignitetech-group/iris-sp-engines \
  --diff-file fixtures/replay/instagram-watermark-fix-reverse.diff

# Machine-readable integrations.
npm run assess -- --repo ignitetech-group/iris-sp-engines --diff-file change.diff --json
npm run assess -- --repo ignitetech-group/iris-sp-engines --diff-file change.diff --sarif
```

The CLI exits nonzero for detected regressions by default. Use `--enforcement warning` during rollout to keep findings advisory.

## GitHub Action

```yaml
name: Behavioral regression review
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  regression-memory:
    runs-on: ubuntu-latest
    steps:
      - uses: YOUR_ORG/iris-regression-memory@v0.2.0
        with:
          enforcement: warning
          comment: "true"
```

The Action creates a sticky pull-request comment and a Check Run. In `warning` mode, a detected historical regression is neutral; in `error` mode it is a failure. Roll out in warning mode, measure precision, then protect the check only after contract owners approve enforcement.

If a fixture repository is reviewing changes on behalf of another codebase, set `target_repository` to the repository whose contracts should apply.

## Local MCP server

Build and expose the same read-only assessment engine to an MCP client:

```bash
npm run build
node /absolute/path/to/iris-regression-memory/dist/mcp.cjs
```

Available tools are `assess_diff`, `assess_pull_request`, `list_contracts`, and `get_contract`. The server uses stdio, writes protocol messages only to stdout, and does not mutate repositories or contracts.

## Outcomes

| Outcome | Meaning |
| --- | --- |
| `historical_regression_detected` | A path-matched approved contract found an explicit violation or removed guard. |
| `no_known_regression` | At least one contract applied and none detected its known failure mechanism. This is not a general correctness claim. |
| `no_applicable_contract` | No contract applied. The result is inconclusive and makes no safety assertion. |

Every result also reports contract coverage as `none`, `partial`, or `full` over reviewable changed files.

## Repository map

```text
contracts/schema.json          Contract validation schema
contracts/iris/*.yaml         Sanitized approved contracts
fixtures/positive/            Synthetic violations
fixtures/negative/            Safe changes
fixtures/replay/              Sanitized historical forward/reverse replays
src/                          Shared engine, CLI, Action, SARIF, and MCP adapters
tests/unit/                    Deterministic contract and replay tests
docs/                         Architecture, evaluation, and authoring guidance
```

See [docs/architecture.md](docs/architecture.md), [docs/contract-authoring.md](docs/contract-authoring.md), and [docs/evaluation.md](docs/evaluation.md).
