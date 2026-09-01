# Local historical benchmark

This benchmark reconstructs pull-request diffs from immutable base and head commit SHAs in local IRIS checkouts. It never creates branches, comments, checks, pull requests, or deployments.

The manifest contains repository names, pull-request numbers, issue keys, commit SHAs, expected outcomes, and contract IDs only. It intentionally excludes authorship, customer data, credentials, environment identifiers, and copied incident conversations.

Run from this repository:

```bash
npm run build
npm run evaluate:local -- --workspace /absolute/path/to/IRIS
```

The evaluator reconstructs each case as `git diff base...head` plus a materialized `git archive` of the head tree (base tree for reverse cases) passed as `--workspace`. Diff-only scoring is not a Truth Compiler metric. `contractRelease` is `truth-compiler-trial`, not the old v0.3.0 Regression Memory label.

Expected labels were updated on 2026-09-01 for leftover and reintroduction semantics:

- `IRIS-TRUTH-0009` is always selected on `iris-api`, so those cases cannot abstain. PRs #860 and #921 fail because the SocialGateway leftover is still in tree. PR #1014 is the cleanup and passes. Later API controls that do not add a new encoded failure also pass.
- `IRIS-TRUTH-0019` is a reintroduction check. PR #1102 newly adds a leading-wildcard `LIKE` and is expected to fail.
- Engine uncovered controls can still abstain.

Do not compare headline precision against the 2026-08-30 BEH-only report. That report treated API leftover trees as pass/inconclusive.

The 32-case manifest combines the original historical replay set with 12 validation PRs frozen before the engine-side watermark rule was added. Case `contract` ids may still use legacy `IRIS-BEH-*` labels; the compiler evaluates the migrated `IRIS-TRUTH-*` facts. Three validation additions remain untouched same-path engine controls. Three remain uncovered engine controls. The six frozen API validation PRs are now expected `pass` because 0009 is selected and holds.

The benchmark is useful for local product development, but it is not a general accuracy guarantee: the contracts were derived from these incident families, and some detection signals were refined after baseline replay. A team decision should therefore consider the untouched controls, explicit abstentions, per-file coverage, and a future prospective shadow run—not headline recall alone.
