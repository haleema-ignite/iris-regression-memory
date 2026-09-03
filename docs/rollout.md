# Rollout

## Where this is now

A local, warning-only experiment. It is not wired into any IRIS repository's CI,
and it cannot fail a merge.

- **There is no assess workflow.** `.github/workflows/assess.yml` used to run on
  every `pull_request` with `enforcement: error`; it has been removed. A
  rewritten `workflow_dispatch` version was removed too, because it could never
  have worked: it passed `--repo $GITHUB_REPOSITORY`, which is this compiler
  repository, and no IRIS truth applies to it. `.github/workflows/ci.yml`
  remains and only runs this repository's own `npm run check`.
- `tenants/iris/tenant.yaml` sets `default_enforcement: warning`.
- `action.yml` defaults `enforcement` to `warning`.
- The CLI defaults to `warning`, and only a truth this change *introduced* can
  exit non-zero even under `error`.

Run it by hand against an IRIS checkout:

```bash
npm run assess -- --tenant iris \
  --repo ignitetech-group/iris-web \
  --pr 1234 \
  --workspace /path/to/iris-web
```

Nothing in this repository should be pointed at an IRIS repository until the
questions below have answers.

## What a verdict means

Three outcomes matter, and they are not the same thing:

| Outcome | Meaning | Who acts |
| --- | --- | --- |
| `fact_failed` | The truth held at base and fails at head, or the evidence is a line this change added. | The author |
| `preexisting_fact_failed` | The truth fails at base too. Any pull request selecting it would report it. | The truth's owner, on a ticket |
| `unattributed_fact_failed` | The truth fails, but no base state was available, so nobody can say who caused it. | Re-run with `--base-ref` |
| `advisory_fact_failed` | Only non-blocking truths failed. | Informational |
| `not_evaluated` | A truth could not be run. A configuration problem, not a regression. | Whoever owns the setup |
| `only_delegated` | Every selected truth was handed to CodeRabbit. Nothing was verified. | Reviewer |

Only `fact_failed` can ever fail a check, in either enforcement mode.

## Attribution needs a base state

Failures are classified by asking the same truth about the state *before* the
change. Pass `--base-ref` (or `--base-workspace`) or attribution is `unknown`.

This is not optional polish. The earlier rule was "did the change touch the file
the evidence points at?", and under it a change that edited
`content-sources.service.ts` without adding any SocialGateway gate was reported
as having *introduced* `IRIS-TRUTH-0009` — the standing leftover that merely
lives in that file. In error mode that would eventually block an innocent
change, which is precisely the credibility this trial is meant to establish.

## The diff and the checkout must be the same revision

For `--pr`, the CLI verifies the checkout is at the pull request head and is
clean, and refuses otherwise. A diff that deletes a control, assessed against a
checkout that still has it, produces a confident and wrong pass.

For `--diff-file` there is nothing to verify against, so the report is labelled
`Revision: UNVERIFIED`. Treat workspace conclusions from a local diff as
indicative, not established.

## Standing ratchets, by branch

A ratchet is only a fact about a named revision. See the table in
`docs/iris.md`; the short version:

- `IRIS-TRUTH-0003` fails on both `iris-web` canonical branches. On
  `origin/main` the promotion grep still selects only `IRISNG-188[45]`; on
  `origin/develop` there is no `test_grep` line at all.
- `IRIS-TRUTH-0009` fails on `iris-api` `origin/main` (two occurrences) and
  **holds** on `origin/develop`. Expect it to disappear as develop merges down.

Both report as `preexisting` when a base state is supplied. Each needs an owner
and a ticket, not a fix in whatever branch happens to trip it.

`IRIS-TRUTH-0005` does **not** currently fail anywhere. An earlier draft of this
document said it did; that reading came from a dirty local feature branch.

## Before enabling any automatic trigger

1. **Shadow first.** Run the CLI by hand, or on a schedule, against recent merged
   pull requests. Read every finding. The trial has never seen a live pull
   request.
2. **Resolve the open proposals.** `IRIS-TRUTH-0020` and `0021` need an owner's
   judgement. `0021` records a documentation-versus-code contradiction that would
   be encoded wrongly if guessed. See `docs/iris.md`.
3. **Close or accept the gaps.** `0015`, `0016` and `0017` are unfinished
   coverage. A green run does not cover them.
4. **Re-verify every current-state claim against a named SHA.** Three truths were
   written from dirty local feature branches and two of them were wrong. Any
   statement about what the code does needs repository, branch, SHA and whether
   the tree was clean.
5. **Do not run as `pull_request_target`.** Product, decision and workspace-mode
   truths read the checkout. A privileged trigger that only fetches a diff cannot
   prove them, and the CLI now refuses to try.

## Promoting one truth to blocking

Promotion is per truth. There is no global switch, and `blocking: true` in a
truth file only means "may fail the check once enforcement is `error`".

A truth qualifies when all of these hold:

- **Evidence.** It has caught a real regression on a live pull request, or on a
  historical replay where the manifest names it in `mustFailTruths` and it did
  fail. `summary.expectationsMet` is the number that matters, not `recall`:
  recall counts cases where *something* failed.
- **A stated proof scope.** An `added_lines` truth must carry `proves`, and the
  registry refuses to load without it. Its pass means "not reintroduced", never
  "the fact holds".
- **Narrow scope.** `applies_to.paths` is scoped, and the signals are real code
  tokens. A signal that is an English description of the failure cannot match
  compiled source and must not be promoted.
- **Mode is deliberate.** `added_lines` for reintroduction, `workspace` only when
  a standing ratchet is intended and owned.
- **Test coverage.** A unit test pins both the detection and at least one
  near-miss that must not fire.
- **Ownership.** `governance.owner` is a role that will answer a question about
  it.
- **An exception path.** `exceptions` exists for recording an owned, reasoned
  waiver with an expiry. A truth with no plausible exception route is a truth
  that will be worked around by disabling it.

Contextual CodeRabbit guidance, uncovered areas, and anything that cannot
establish evidence stay advisory permanently.

## Emitters

`npm run compile` writes two Semgrep files, and they are not interchangeable:

- `semgrep.yml` — whole-checkout rules. Safe in a repository-wide Semgrep config.
- `semgrep-diff-scan.yml` — rules from `added_lines` truths. These **must** run
  with `--baseline-commit`. Semgrep `pattern-regex` matches entire files, so a
  repository-wide run reports pre-existing code the truth explicitly does not
  claim. `IRIS-TRUTH-0019` alone would raise 78 findings across 11 files in
  iris-api that way.
