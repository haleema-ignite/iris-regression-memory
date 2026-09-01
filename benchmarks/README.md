# Local historical benchmark

This benchmark reconstructs pull-request diffs from immutable base and head commit SHAs in local IRIS checkouts. It never creates branches, comments, checks, pull requests, or deployments.

The manifest contains repository names, pull-request numbers, issue keys, commit SHAs, expected outcomes, and contract IDs only. It intentionally excludes authorship, customer data, credentials, environment identifiers, and copied incident conversations.

Run from this repository:

```bash
npm run build
npm run evaluate:local -- --workspace /absolute/path/to/IRIS
```

The evaluator reconstructs each case as `git diff base...head` plus a materialized `git archive` of the head tree (base tree for reverse cases) passed as `--workspace`. Diff-only scoring is not a Truth Compiler metric. `contractRelease` is `truth-compiler-trial`, not the old v0.3.0 Regression Memory label.

The 32-case manifest combines the original historical replay set with 12 validation PRs frozen before the engine-side watermark rule was added. Case `contract` ids are the legacy IRIS-BEH labels; the compiler now evaluates the migrated `IRIS-TRUTH-*` facts. Three of the additions are untouched same-path controls and nine are uncovered controls.

The benchmark is useful for local product development, but it is not a general accuracy guarantee: the contracts were derived from these incident families, and some detection signals were refined after baseline replay. A team decision should therefore consider the untouched controls, explicit abstentions, per-file coverage, and a future prospective shadow run—not headline recall alone.
