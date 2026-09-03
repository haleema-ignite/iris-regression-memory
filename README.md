# Truth Compiler

Stop adding reviewers. Compile facts.

Truth Compiler learns a GitHub system and keeps a **single registry of facts that must remain true**. On every pull request it classifies each fact onto the cheapest correct executor — Semgrep, CodeRabbit, a contract fixture, a product presence check, or a leftover-decision scan — and **fails if that executor fails**.

IRIS is tenant zero, not the product. Point it at another org, incidents, and UI catalog, and it learns that system instead.

This repository used to be a weak diff-string “regression memory.” That engine could only fail when an added line contained a remembered snippet. It could not prove Generate Campaign was still on the calendar, could not see a leftover SocialGateway gate outside the diff, and it duplicated work CodeRabbit and Semgrep already do. This release replaces it.

## What it is not

- Not a second CodeRabbit. IgniteTech policy: other AI reviewers run **on top of** CodeRabbit, never instead of it.
- Not a second Semgrep. Pattern facts are **emitted** as Semgrep rules and also proven in-process so the fact is not stuck in a drawer.
- Not an LLM merge gate. Models may propose truths. They do not decide the verdict.

## Executors

| If the fact is… | Executor |
| --- | --- |
| A bad shape in one language (`LIKE '%x%'`, nested `apiParams`) | `pattern` / `semgrep` |
| Ticket intent, local design, shared-shell review judgment | `coderabbit` (emit path instruction; compiler does not re-review) |
| Two sides must agree (Care `int_meta` is `Map<String,String>`) | `contract` |
| The customer can still do the thing (Generate Campaign) | `product` |
| A finished decision left a leftover gate | `decision` (scans checkout, not only the diff) |

Inclusive matching: path hit, coupling (calendar header owns Generate Campaign), always-on product catalog, and stale-decision scan.

## Status: local, warning-only trial

Not wired into any IRIS repository's CI, and it cannot fail a merge.
`docs/rollout.md` is the gate for changing that, and lists what has to be true
before any automatic trigger is enabled.

## Run it

```bash
npm ci
npm run check          # tests, typecheck, compile, build

# Local diff against the IRIS tenant. --workspace is required.
npm run assess -- --tenant iris --repo ignitetech-group/iris-web \
  --diff-file change.diff --workspace /path/to/iris-web

# Emit Semgrep rules and CodeRabbit path instructions
npm run compile
```

`--workspace` is mandatory: product, decision and workspace-mode truths read the
checkout, and a file reconstructed from hunk context is not the file. `--repo`
must name a repository declared in `tenant.yaml`, so a typo is an error rather
than a clean-looking abstention.

Enforcement defaults to `warning` (exit 0). In `error` mode only failures this
change *introduced* exit nonzero; a pre-existing ratchet is always neutral.

## Reading a verdict

| Outcome | Meaning |
| --- | --- |
| `fact_failed` | A truth failed on lines this change added, or in a file it touched. The author's to fix. |
| `preexisting_fact_failed` | A truth failed against the checkout as it already stood. Needs an owner and a ticket, not a fix in this branch. |
| `selected_truths_hold` | The selected truths were checked and hold. Not a statement about uncovered files. |
| `only_delegated` | Truths were selected but all were handed to CodeRabbit. Nothing was verified. |
| `no_selected_truth` | No live truth applied. Not a safety assertion. |

A delegated CodeRabbit hand-off is reported as `delegated`, never as a pass:
counting a hand-off as a verified fact is the invented pass this design exists to
avoid.

`File coverage` counts files some executor actually read. A truth being selected
does not mean it inspected every changed file.

### Standing ratchets on the current checkouts

- `IRIS-TRUTH-0003` — QA promotion still greps only `IRISNG-188[45]`, so
  Generate Campaign P14 is not on the promotion path.
- `IRIS-TRUTH-0009` — Marketing Meta shared mode still hard-requires
  `SOCIALGATEWAY_*` in `iris-api`.

Both report as `preexisting`, not as your regression. Fix the fact, or record an
owned `exceptions` entry — do not delete the truth.

## GitHub Action

Packaged but not wired up anywhere. There is no assess workflow in this
repository — see `docs/rollout.md` for why, and for the manual command to use
instead. `action.yml` defaults to `enforcement: warning`.

Do not run it as a privileged `pull_request_target` that only fetches a diff:
product truths need the service checkout, and the CLI refuses to run without
one.

## Tenant layout

```text
tenants/
  schema/                 Generic JSON Schema (any GitHub org)
  iris/                   Tenant zero
    tenant.yaml
    catalog/
      product-surfaces.yaml
      coupling.yaml
    truths/*.yaml
    emitters/             Generated Semgrep + CodeRabbit fragments
      semgrep.yml               whole-checkout rules
      semgrep-diff-scan.yml     added-lines rules; needs --baseline-commit
```

A truth is `live` (can fail), `proposed` (drafted or an observation awaiting an
owner's decision), or `gap` (unfinished coverage, still visible). Gaps are not
“out of scope,” and they are reported on every assessment.

The two Semgrep files are **not** interchangeable. `semgrep-diff-scan.yml` holds
rules from truths that only claim added lines; Semgrep `pattern-regex` matches
whole files, so a repository-wide run of those rules reports pre-existing code
the truth explicitly does not claim — 78 findings across 11 files for
`IRIS-TRUTH-0019` alone. Run it with `--baseline-commit`.

Signals must be real code tokens. A signal that is an English description of the
failure (`fail open`, `skip persistState`) can only match a fixture written to
contain it, and reports coverage that does not exist. See
`docs/truth-authoring.md`.

## Safety

Public truths contain issue keys, paths, and technical invariants. They must not contain customer data, credentials, copied Slack, or personal attribution.

## MCP

```bash
npm run build
node dist/mcp.cjs
```

Tools: `assess_diff`, `assess_pull_request`, `list_truths`, `get_truth`, `compile_emitters`.
