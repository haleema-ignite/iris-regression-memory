# Local evaluation follow-up — 2026-08-30

**Scope:** local and read-only against IRIS Git history

**Product state:** v0.3.0 candidate

**Company integration:** none

## Executive result

The previous 20-case evaluation had one false negative: `iris-sp-engines` PR #222, one half of the Instagram restart/comment-replay incident. The root cause was a limitation in deterministic adjudication, not retrieval. The correct contract and production path were selected, but the engine-side unsafe shape was an omission rather than one of the API-side violation strings already encoded.

The contract language and adjudicator now support approved regular-expression patterns over individual added lines. `IRIS-BEH-0002` uses this to identify the precise unsafe shape introduced by PR #222: comment polling state persisted with `seenIds` as the only guard and no bounded watermark in that call.

Before the detector change, a 12-PR validation expansion was frozen using immutable commit SHAs. The combined 32-case benchmark now classifies **32 of 32** cases as expected:

| Metric | Before #222 repair, expanded set | Current candidate |
| --- | ---: | ---: |
| Total cases | 32 | 32 |
| Expected regressions | 10 | 10 |
| Regressions detected | 9 | **10** |
| Recall on this set | 90% | **100%** |
| False positives | 0 | **0** |
| Precision on this set | 100% | **100%** |
| Safe applicable PRs correctly passed | 10/10 | **10/10** |
| Uncovered PRs correctly abstained | 12/12 | **12/12** |

This is 100% accuracy on a bounded replay and frozen-validation set. It is not evidence that the product detects every possible IRIS regression.

## What went wrong in PR #222

### Behavioral failure chain

The production behavior depended on two repositories:

1. The Instagram engine rescanned comments from recent media so late replies could still be discovered.
2. PR #222 persisted comment state using dedup IDs, but intentionally supplied no comment watermark or timestamp floor.
3. The API-side store introduced by PR #695 removed dedup IDs after 48 hours.
4. A restart reloaded the pruned ID set.
5. Older comments still returned by the engine's media rescan no longer appeared in the restored set and could be published again.

Neither repository contained an ordinary syntax or type error. The incompatibility was between an unbounded rescan horizon and a shorter durable dedup-retention horizon.

### Why the previous detector passed it

Retrieval behaved correctly:

- `IRIS-BEH-0002` was selected;
- the Instagram polling path matched;
- the diff had full patch availability for the relevant files.

Adjudication then found no failure evidence because the v2 contract only encoded:

- explicit disabling or in-memory-only signals;
- the API-side combination of the 48-hour TTL and `mergeSeenIds`;
- removal of a known comment-floor guard.

PR #222 added a new unsafe composition. It did not remove a guard that previously existed, and it did not contain the API repository's TTL constant. The old engine therefore returned an applicable `pass` even though the cross-repository system was unsafe.

### Why the repair is narrow

The repair does not use similarity or a general `seenIds` keyword. It adds `violation_line_patterns`, evaluated only when all existing gates pass:

1. contract status is `approved`;
2. repository matches;
3. production path matches;
4. the regular expression matches an added line.

For `IRIS-BEH-0002`, the pattern matches a `persistState(account, "comments", ...)` call whose object contains only `seenIds`. A corresponding unit test proves that adding a bounded `watermark` field does not match. Invalid contract regular expressions are rejected when contracts load.

This captures the engine-side manifestation of the known incompatibility without requiring the API diff to be present in the same pull request.

## Expanded validation design

The 12 new cases were selected and assigned expected outcomes before the #222 rule was added.

### Same-path controls

These PRs exercise contract-covered files but do not recreate the encoded failures:

| Repository | PR | Expected | Result |
| --- | ---: | --- | --- |
| `iris-sp-engines` | #291 | pass | **pass** |
| `iris-sp-engines` | #340 | pass | **pass** |
| `iris-sp-engines` | #361 | pass | **pass** |

These are especially important because they test whether the new #222 rule turns ordinary Instagram or Meta changes into false positives.

### Uncovered controls

Nine additional PRs change Pinterest, RSS, YouTube, Care conversation behavior, queue automation, Instagram publishing, or database indexes outside the encoded contract paths:

| Repository | PRs | Expected | Result |
| --- | --- | --- | --- |
| `iris-sp-engines` | #334, #365, #390 | inconclusive | **3/3 inconclusive** |
| `iris-api` | #1081, #1098, #1110, #1146, #1148, #1152 | inconclusive | **6/6 inconclusive** |

The manifest contains no authorship and uses immutable Git object IDs. One squash-merged control uses the merged commit and its direct parent so the local diff contains only that PR rather than intervening base-branch changes.

## Full benchmark composition

The 32 cases contain:

- 4 historical culprit or contributing PRs;
- 7 historical fixing PRs;
- 6 exact reverse-fix counterfactuals;
- 3 earlier uncovered controls;
- 3 newly frozen same-path controls;
- 9 newly frozen uncovered controls.

Expected outcomes are:

- 10 `fail`;
- 10 `pass`;
- 12 `inconclusive`.

The current confusion matrix has zero false negatives and zero false positives on this set.

## Performance

Five sequential full benchmark repetitions produced stable results:

| Measurement | Observed range |
| --- | ---: |
| Total for 32 PRs | 4.97–5.05 seconds |
| Mean per PR | 155.4–157.8 ms |
| Median per PR | 151.1–152.1 ms |
| p95 per PR | 184.8–187.4 ms |
| Maximum PR | 209.8–217.2 ms |

All five repetitions classified 32/32 cases correctly. Adjudication remains local and deterministic, with no model call or external retrieval call in the decision path.

## Verification

- 48 unit/replay tests pass.
- TypeScript type checking passes.
- All distributable bundles build successfully.
- Contract schema validation passes for all seven approved contracts.
- The benchmark has 32 unique immutable cases.
- The precise unsafe comment-persistence line fails.
- A comment-persistence call containing a bounded watermark passes.
- The three new same-path controls remain passes.
- The twelve total uncovered controls remain inconclusive.

## What “100%” can responsibly mean

The product can target **100% detection of encoded, replayable known regressions** and **zero false positives in the maintained validation suite**. It cannot honestly promise universal 100% detection of unintended behavior because contracts cannot cover incidents that have never been encoded, incomplete GitHub patches can hide evidence, and novel cross-service interactions may have no local signature yet.

The current 100% result has three important limitations:

1. The historical cases are not a holdout; the contracts came from those incidents.
2. The #222 case was used to design this repair, so it proves regression coverage rather than generalization.
3. The 12 frozen additions are useful negative validation, but there are no new positive incident families in that frozen set.

## Plan toward a defensible release gate

1. Preserve these 32 cases unchanged as the regression suite.
2. Add at least 20 more untouched same-path controls, emphasizing Instagram polling, Facebook bootstrap, webhook credential rotation, and legacy integration provisioning.
3. Create mutations for every required guard, including formatting variants and multiline calls, without changing the production repositories.
4. Build a time-sliced positive holdout from newly confirmed incidents and forbid contract tuning until the holdout result is recorded.
5. Add explicit contract-level telemetry: retrieval count, applicable-pass count, finding count, uncovered production paths, and patch-unavailable rate.
6. Require zero false positives on the maintained same-path controls and 100% replay of every approved known culprit before any contract can enter enforcement mode.
7. After team review and explicit repository approval, run warning-only shadow evaluation prospectively. Do not block merges during this phase.
8. Consider enforcement only for individually approved contracts that maintain prospective precision and have an owner, expiry, and rollback path.

## Decision

The #222 false negative is repaired, and the expanded local benchmark is clean. The product is ready for further local holdout construction and team review. It is not yet justified as a required company check, and no company repository integration is part of this evaluation.
