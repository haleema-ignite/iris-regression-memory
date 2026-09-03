# Authoring truths

A truth is allowed into `live` only when it is falsifiable, cited, scoped, and
routed to the cheapest correct executor.

## Required fields

- `statement` — the fact that must remain true
- `executor.kind` — `pattern`, `product`, `contract`, `decision`, `semgrep`, or `coderabbit`
- `applies_to.repositories` — GitHub `owner/name`, and it must be declared in
  `tenant.yaml`; an undeclared repository is rejected at load, because a truth
  scoped to one can never be selected
- `evidence` — issue key, RCA, e2e case, or public doc
- `governance.owner` — role, not a person (`publisher-maintainers`)

## A repository claim needs a revision

Any statement about what the code currently does must name the repository, the
branch, the exact SHA, and whether the checkout was clean. Without that it is not
a fact, it is an impression.

This is not a style rule. Three truths were written from local feature branches
that were dirty and months behind:

- `IRIS-TRUTH-0012` was demoted to `gap` on the belief that the community engine
  had no hidden-board handling. The IRISNG-3231 fix is present on both
  `origin/main` and `origin/develop`; the local branch simply predated it. The
  demotion was wrong and has been reverted.
- `IRIS-TRUTH-0020` claimed "7 of 28 engines". The real counts are 6 of 28 on
  `origin/main` and 8 of 29 on `origin/develop`. Seven was an artefact of a dirty
  tree and matched neither.
- A proposed `IRIS-TRUTH-0022` asserted that a Meta webhook fix had been
  reverted. It had not: the guard is on `origin/develop` and simply had not
  reached `origin/main`. The truth was deleted.

Record provenance in the truth file, like this:

```yaml
# Verified on both canonical branches:
#   origin/main    9096fb2d6ac83c775fc7f117fbe9e4a617dcfce5
#   origin/develop b516fb5836dd79bd1534c79b27d2415aa8db55ac
```

## Signals must be code, not prose

This is the rule that matters most, and the one the first draft of this registry
broke seven times.

A signal is matched against source text. `fail open`, `skip persistState`,
`engine-wide auth failure` and `Date.now() as dedup` are descriptions of a
failure, not tokens that appear in TypeScript. They can only ever match a
fixture written to contain them, which makes the registry report coverage that
does not exist — worse than a `gap`, because a gap is honest.

Before setting a signal, grep the real repository for it. If it is not there and
would not plausibly be written, it is not a signal. Every historical detection in
the benchmark came from a real code token, a real log string, or a regex over
real syntax.

Comments are not behaviour. All matching runs against a comment-stripped view, so
a comment that names an anti-pattern in order to warn about it is not a
violation, and a comment that names a deleted control is not that control.

## Routing

- If Semgrep can see it, set `emit: semgrep` with a `forbidden_line_pattern` or
  `forbidden_signals`. A truth that declares `emit: semgrep` but compiles to no
  rule is rejected at load: it would make the manifest claim Semgrep coverage
  that does not exist. `IRIS-TRUTH-0008` is the worked example — a query anchor
  cannot be expressed as a regex, so it is `emit: none`.
- If CodeRabbit should carry review intent, use `kind: coderabbit`. It returns
  `delegated`, never `pass`.
- If the customer can still do the thing, use `kind: product`. Prefer
  `must_contain_patterns` over `must_contain` when the substring would also
  match a comment or a type declaration: `>\s*Generate Campaign` proves a
  rendered label, `Generate Campaign` proves only that someone mentioned it.
- If the dangerous file is often not in the PR, use `kind: decision` with
  `scan_workspace: true`. Prefer `leftover_patterns` over `leftover_tokens` when
  the token is an error message, so rewording it does not silently turn the
  ratchet into a pass.
- If two consumers must agree, use `kind: contract`.
- If a required guard must exist in scoped files, set `require_present: true`.
  Guards are checked per file: all of them must hold together in one file, since
  the point of a multi-guard rule is that they appear at the same decision site.

## Mode, and who gets blamed

`mode` decides who a failure is charged to, so it is not a detail.

- `added_lines` — a reintroduction check. Adjudicates only lines the change
  added, ignoring additions that merely reformat or re-add a line the same change
  removed, and reporting only when the number of violating lines increases.
  Editing a query that already violated is not a reintroduction.
- `workspace` / `both` — a standing ratchet against the checkout. Legitimate, but
  it will fire for authors who did not cause it, so it needs an owner who is
  prepared to field that.

A failure is classified `introduced` when the evidence came from added lines or
from a file the change touched, and `preexisting` otherwise. Only `introduced`
failures can fail a check.

## Exceptions

`exceptions` records an owned, reasoned waiver:

```yaml
exceptions:
  - path: src/services/admin/source-integrations.service.ts
    reason: Documented legacy-parity decision; see the ticket on the call site.
    approved_by: care-compatibility-maintainers
    expires: 2027-03-01
```

A waived violation is reported in its own section, never silently dropped. An
expired exception stops waiving. Prefer narrowing `mode` or `paths` over an
exception — `IRIS-TRUTH-0005` needed no exception once it became `added_lines`.

## `proves`

Where the executor proves something narrower than the statement, say so in
`proves`. It is rendered next to every pass, so a reader cannot over-read it. A
product truth that greps a `.tsx` file proves the source names a thing; only the
e2e case proves a user can click it.

## Status

1. `gap` — the class is known and cannot be proved yet. Shape requirements are
   relaxed, because forcing a gap to be fully specified means inventing the very
   check whose absence it documents.
2. `proposed` — drafted, cannot fail. Use this for an observation that needs an
   owner's judgement before it is encoded.
3. `live` — blocking or advisory according to `executor.blocking`
4. `superseded` / `deprecated` — ignored

Demoting a live truth to `gap` is the correct move when its guard turns out not
to exist in the code. `IRIS-TRUTH-0012` and `0015` were demoted for exactly that.
Record why in a comment in the truth file.

## Public hygiene

No customer data, credentials, Slack dumps, or personal names.
