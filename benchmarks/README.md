# Local historical benchmark

This benchmark reconstructs pull-request diffs from immutable base and head commit SHAs in local IRIS checkouts. It never creates branches, comments, checks, pull requests, or deployments.

The manifest contains repository names, pull-request numbers, issue keys, commit SHAs, expected outcomes, and contract IDs only. It intentionally excludes authorship, customer data, credentials, environment identifiers, and copied incident conversations.

Run from this repository:

```bash
npm run build
npm run evaluate:local -- --workspace /absolute/path/to/IRIS
```

The evaluator reconstructs each case as `git diff base...head` plus a materialized `git archive` of the head tree (base tree for reverse cases) passed as `--workspace`. Diff-only scoring is not a Truth Compiler metric. `contractRelease` is `truth-compiler-trial`, not the old v0.3.0 Regression Memory label.

Expected labels follow leftover and reintroduction semantics:

- `IRIS-TRUTH-0009` is always selected on `iris-api`, so those cases cannot abstain. PRs #860 and #921 fail because the SocialGateway leftover is still in tree. PR #1014 is the cleanup and passes. Later API controls that do not add a new encoded failure also pass.
- `IRIS-TRUTH-0019` is a reintroduction check.
- Engine uncovered controls can still abstain.

Do not compare headline precision against the 2026-08-30 BEH-only report. That report treated API leftover trees as pass/inconclusive.

## Correction, 2026-09-02: PR #1102

This case was labelled `fail` on the description "newly adds a leading-wildcard
`LIKE`". It does not. The only `LIKE` change in that diff adds a table alias to a
wildcard that already existed:

```diff
-            AND his_metadata LIKE '%"reason":"STOP_KEYWORD"%'`,
+            AND h_opt.his_metadata LIKE '%"reason":"STOP_KEYWORD"%'`,
```

The original `fail` came from treating a modified line as an added line, which is
the false positive that fired on every reformat of the 78 pre-existing wildcards
across 11 files in `iris-api`. The case is now `expected: pass`, and
`IRIS-TRUTH-0019`'s positive detection is still validated on real history by
`culprit-legacy-care-574` and by a unit test that adds a genuinely new wildcard.

## Read attribution, not just recall

`summary.matched` is the weakest useful number. The evaluator also reports:

- `attributedRecall` — the share of expected-fail cases that failed on the truth
  they were filed under, currently **10 of 12**.
- `ratchetOnlyCases` — the cases that failed only because of an unrelated
  standing ratchet: `fix-tiktok-legacy-860` and `fix-listener-legacy-921` fail on
  `IRIS-TRUTH-0009`, not on the `IRIS-BEH-0007` contract they are filed under.

`recall` of 12/12 therefore overstates detection. Quote `attributedRecall`.

## What the manifest does not cover

Every case is `iris-api` or `iris-sp-engines`. There are **no `iris-web` or
`iris-e2e` cases**, so `IRIS-TRUTH-0001`–`0004` — the Generate Campaign family,
the incident that motivated the project — are never exercised here. Their
coverage comes from unit tests and from running the CLI against an `iris-web`
checkout.

The 32-case manifest combines the original historical replay set with 12 validation PRs frozen before the engine-side watermark rule was added. Case `contract` ids may still use legacy `IRIS-BEH-*` labels; the compiler evaluates the migrated `IRIS-TRUTH-*` facts. Three validation additions remain untouched same-path engine controls. Three remain uncovered engine controls. The six frozen API validation PRs are now expected `pass` because 0009 is selected and holds.

The benchmark is useful for local product development, but it is not a general accuracy guarantee: the contracts were derived from these incident families, and some detection signals were refined after baseline replay. A team decision should therefore consider the untouched controls, explicit abstentions, per-file coverage, and a future prospective shadow run—not headline recall alone.
