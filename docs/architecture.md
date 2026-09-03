# Architecture

```text
tenant + catalogs + truths          (rejected at load if unenforceable)
        |
        v
PR diff + checkout (workspace, required)
        |
        v
inclusive match (path, coupling, product catalog, stale decision)
        |
        v
executor (pattern | product | contract | decision | semgrep | coderabbit)
        |
        v
verdict per truth: pass | fail | delegated
        |
        v
classify each failure: introduced | preexisting
apply recorded exceptions -> waived
        |
        v
assessment + visible gaps
   /        |         \
Markdown   SARIF     Semgrep emitters (whole-checkout | diff-scan)
                     CodeRabbit path instructions
```

Matching is comment-stripped throughout: a token found only in a comment is not
evidence that a behaviour exists, and a comment quoting an anti-pattern in order
to warn about it is not a violation of it.

## Three things a truth can return

`pass` — the executor checked and the fact holds.
`fail` — the executor checked and it does not.
`delegated` — the compiler checked nothing and handed the question to CodeRabbit.

`delegated` is counted separately from `pass`. If every selected truth is
delegated, the assessment is `inconclusive`, not a pass: nothing was verified.

## Two kinds of failure

A failure is `introduced` when its evidence came from lines the change added, or
from a file the change touched. Otherwise it is `preexisting` — a standing
ratchet that any pull request selecting that truth would report.

Only `introduced` failures can fail a check. This is the difference between a
regression signal and a leftover the current author did not create.

## Coverage means inspection

A changed file counts as covered only if some selected truth's executor would
actually read it. Selection is not inspection: a product truth reads only the
files it names, and a delegated truth reads nothing.

## Where this runs

Locally, by CLI, with `--workspace` pointing at the service checkout. Product,
decision and workspace-mode truths read that checkout; a diff alone cannot prove
them, so the CLI refuses to run without one.

Not currently wired to any IRIS repository — see `docs/rollout.md`.

LLM is not on the verdict path.
