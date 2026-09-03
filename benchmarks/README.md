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

## Read the exhaustive metric, not recall

`summary.matched` is the weakest useful number: it only says the whole-registry
verdict matched. Quote **`summary.casesMeetingNamedExpectations`**, currently
**34 of 34**.

Expectations are exhaustive. `mustFailTruths`, `mustPassTruths` and
`mustNotFailTruths` name required outcomes, and any truth that fails without
appearing in `mustFailTruths` or `alsoAllowedToFail` is a violation.
`alsoAllowedToFail` holds only the standing ratchets for that repository
(`IRIS-TRUTH-0003` on web, `IRIS-TRUTH-0009` on api).

That change mattered. "Zero false positives" had been true only per case — on an
expected-fail case an extra wrong truth failure changed nothing, and 23 cases
constrained nothing at all. Making it exhaustive surfaced five real detections
the old scoring had hidden, and all five were correct:

- `IRIS-TRUTH-0019` genuinely fires on PR 574, which adds
  `his_metadata LIKE '%"reason":"STOP_KEYWORD"%'`.
- `IRIS-TRUTH-0006` genuinely fires on four iris-api trees carrying
  `intMetaOverride.apiParams = {`, the IRISNG-4090 nested-object shape. It is
  absent from both canonical branches, so it is historical rather than live.

Both are now required, so they cannot silently stop being detected.

## This is a regression suite, not a validation set

The truths were derived from these incident families, several signals were
refined after the first replay, and two case labels were corrected after review.
A suite you tuned against cannot measure your own accuracy — it can only stop
you regressing. A prospective, read-only cohort of current pull requests, scored
before any rule is adjusted, is the only real validation, and it has not been
run.

## What the manifest does not cover

There are no `iris-e2e` cases, so `IRIS-TRUTH-0004` is exercised only by unit
tests. `IRIS-TRUTH-0001` and `0002` are covered on real history by
`culprit-generate-campaign-removed` (`040a6668`) and
`fix-generate-campaign-restored` (`ae0c4061`) — added because the Generate
Campaign family previously had no real-history coverage at all, which is exactly
where a false negative was found.

The 32-case manifest combines the original historical replay set with 12 validation PRs frozen before the engine-side watermark rule was added. Case `contract` ids may still use legacy `IRIS-BEH-*` labels; the compiler evaluates the migrated `IRIS-TRUTH-*` facts. Three validation additions remain untouched same-path engine controls. Three remain uncovered engine controls. The six frozen API validation PRs are now expected `pass` because 0009 is selected and holds.

The benchmark is useful for local product development, but it is not a general accuracy guarantee: the contracts were derived from these incident families, and some detection signals were refined after baseline replay. A team decision should therefore consider the untouched controls, explicit abstentions, per-file coverage, and a future prospective shadow run—not headline recall alone.
