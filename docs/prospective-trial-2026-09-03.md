# Prospective warning-mode trial — 2026-09-03

This is the first read-only cohort run against pull requests that were open when
selected. It is separate from the tuned 34-case historical regression suite.
No IRIS repository, pull request, check, comment, or GitHub setting was changed.

## Method

- Read the open pull-request lists for `iris-api`, `iris-web`, and
  `iris-sp-engines` before assessment.
- Materialize each exact PR head in a clean temporary checkout.
- Run the packaged `dist/cli.cjs` in `warning` mode with `--pr` and the real
  repository name.
- Require the reported workspace SHA to equal GitHub's head SHA and record the
  attribution base used by the compiler.

This is a small operational smoke cohort, not an accuracy estimate. It can
surface obvious false positives, revision errors, and dishonest coverage. It
cannot measure recall because these PRs were not independently labelled for
every regression family.

## Results

| Repository | PR | Head | Outcome | Coverage | Introduced failures |
| --- | ---: | --- | --- | --- | ---: |
| iris-api | 1184 | `b5a2eaa6` | selected truths hold | full | 0 |
| iris-api | 1183 | `06377566` | selected truths hold | full | 0 |
| iris-api | 1179 | `eaa1a58d` | pre-existing `IRIS-TRUTH-0006` | partial | 0 |
| iris-web | 745 | `9e306f7f` | pre-existing `IRIS-TRUTH-0003` | none | 0 |
| iris-sp-engines | 73 | `ada22b36` | selected truths hold | partial | 0 |
| iris-sp-engines | 377 | `1521883c` | no selected truth | none | 0 |
| iris-sp-engines | 263 | `2475ae22` | no selected truth | none | 0 |

All seven revisions were verified against their PR heads. Three selected checks
held, two runs reported only standing/historical workspace facts as
`preexisting`, and two correctly abstained because no truth applied. No run
reported an introduced regression and warning mode returned success for every
case.

The two pre-existing findings are not attributed to those PRs:

- API PR 1179 carries the historical `intMetaOverride.apiParams = {` shape
  detected by `IRIS-TRUTH-0006`; the canonical probe confirms it is absent from
  current `origin/main` and `origin/develop`.
- Web PR 745 carries the known QA-promotion ratchet `IRIS-TRUTH-0003`.

## What this qualifies

The CLI is ready for a maintainer-only, local, warning-mode team trial. This run
does **not** qualify automatic GitHub execution or merge blocking. Continue to
record prospective results, independently review any introduced finding, and
leave uncovered files and `no_selected_truth` outcomes explicitly inconclusive.
