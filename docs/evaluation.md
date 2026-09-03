# Evaluation

```bash
npm test
npm run typecheck
npm run compile
npm run build
# or all four:
npm run check
```

## What the unit tests cover

- pattern reversals of Meta signatures, Instagram watermarks, Care enum writes
- product: Generate Campaign missing vs present, promotion grep trap, and the
  comment-ghost case — the control deleted while comments still name it
- contract: nested `int_meta` including `intMetaOverride.apiParams = {`,
  `int_deleted` dropped vs dynamically composed vs historical joins
- decision: leftover SocialGateway gate outside the diff
- reintroduction vs leftover: `0008`/`0019` adjudicate added lines; `0009` scans
  the checkout
- `tests/unit/correctness.test.ts` pins each defect found during review:
  comment-blind matching, reformatted-line false positives, cross-file guard
  contamination, union-haystack required guards, coverage inflation,
  delegated-as-pass, exception expiry, and load-time rejection of
  unenforceable configuration

## Reading the benchmark

```bash
npm run build
npm run evaluate:local -- --workspace /absolute/path/to/IRIS
```

`summary.matched` — 34/34 — is the weakest useful claim, because it only says
the whole-registry verdict matched. The number to quote is
**`summary.expectationsMet`**, currently **34 of 34**: every truth the manifest
names in `mustFailTruths`, `mustPassTruths` or `mustNotFailTruths` did what the
case says it must.

The manifest is `schemaVersion: 2` for this reason. A single `contract` field
could not express a fix case: PRs 860 and 921 are the *fix* for IRIS-BEH-0007,
so `IRIS-TRUTH-0005` must **pass** there, while the overall verdict still fails
on the unrelated `IRIS-TRUTH-0009` leftover. Scored against one field they read
as "detected only by another truth" and dragged the headline down for no reason.

Each case is now assessed with both trees materialized — head as `--workspace`,
base as `--base-workspace` — so failures are attributed rather than reported as
unknown.

### Real coverage of the flagship family

`culprit-generate-campaign-removed` (`040a6668`) and
`fix-generate-campaign-restored` (`ae0c4061`) are the real removal of the
Generate Campaign button and wizard, and its revert. They were added because
`IRIS-TRUTH-0001`–`0004` previously had **no** real-history coverage at all —
which is exactly where the false negative was found. On the removal, 0001 and
0002 fail as `introduced`; on the revert they pass and only the standing 0003
promotion ratchet remains.

A "pass" on a benchmark case still usually means the always-selected truths for
that repository held, not that the change was verified safe. For `iris-api` that
is `0008`, `0009` and `0019` on nearly every case.

## What a pass does not mean

A pass means the selected truths hold. It does not mean the change is safe, and
it does not mean uncovered files were examined — `coverage.uncoveredFiles` lists
what nothing inspected. `gap` and `proposed` truths are the unfinished list and
are reported on every assessment.

Delegated truths are counted separately from passes. A CodeRabbit hand-off
verified nothing, so it is never a verified fact.

Detection signals for several truths were refined after the original replay, and
the truths were derived from these incident families. That makes the benchmark
useful for local development and unsuitable as an accuracy guarantee. A team
decision should weigh the untouched controls, the explicit abstentions, per-file
coverage and a prospective shadow run — see `docs/rollout.md`.
