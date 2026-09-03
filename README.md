# Truth Compiler

Stop adding reviewers. Compile facts.

Truth Compiler keeps a **single registry of facts that must remain true**. Locally it classifies each fact onto the cheapest correct executor — Semgrep, CodeRabbit, a contract fixture, a product presence check, or a leftover-decision scan — and **fails if that executor fails**.

The team trial is **local**. Clone this repo, point it at your IRIS checkouts, and run the full surface: every live truth, every executor, workspace proofs, emitter compile, MCP, and the historical benchmark. It does not write to GitHub.

IRIS is tenant zero, not the product.

## Team local trial

```bash
git clone -b trial https://github.com/haleema-ignite/iris-regression-memory.git
cd iris-regression-memory
npm ci

# Full local surface against sibling IRIS checkouts (iris-web, iris-api, iris-sp-engines, iris-e2e)
npm run trial:local -- --iris-root /absolute/path/to/IRIS
```

`trial:local` runs unit tests, typecheck, emitter compile, build, `list`, a **checkout assess** of each present IRIS service (product + leftover facts on the tree), a **working-tree assess** vs `main`/`master`, and the 34-case historical benchmark. Use `--skip-check` or `--skip-benchmark` only if you are iterating on one slice. `--strict` fails the script on working-tree findings; by default those are your branch, not a broken compiler.

Current IRIS HEAD still violates two live facts. Seeing them is the full trial,
not a broken install:

- `iris-web`: `IRIS-TRUTH-0003` — QA promotion still greps only `IRISNG-188[45]`
- `iris-api`: `IRIS-TRUTH-0009` — Marketing Meta shared mode still requires
  `SOCIALGATEWAY_*` on `origin/main`. It **holds** on `origin/develop`, so
  expect it to disappear as develop merges down.

`trial:local` treats those two as expected until the facts become true. Any
other blocking failure is unexpected. Both report as `preexisting` rather than
as your regression, because the local mode supplies the diff base as the
attribution base.

### One service at a time

`--workspace` is required for product, leftover-decision, and `require_present` facts. A diff-only run is not the full compiler.

```bash
npm run assess -- --tenant iris --repo ignitetech-group/iris-web \
  --workspace /path/to/iris-web

npm run assess -- --tenant iris --repo ignitetech-group/iris-api \
  --workspace /path/to/iris-api --json
```

Optional: pass `--diff-file change.diff` or `--base origin/main --head HEAD` if you already have a patch. Optional: `--pr 1014` if you have `gh` auth and want to fetch a GitHub patch **read-only**. The local trial does not need that.

```bash
npm run list
npm run compile
npm run evaluate:local -- --workspace /absolute/path/to/IRIS
npm run mcp
```

MCP tools: `assess_checkout`, `assess_diff`, `assess_pull_request`, `list_truths`, `get_truth`, `compile_emitters`. Prefer `assess_checkout` for local work.

## What it is not

- Not a second CodeRabbit. IgniteTech policy: other AI reviewers run **on top of** CodeRabbit, never instead of it.
- Not a second Semgrep. Pattern facts are **emitted** as Semgrep rules and also proven in-process.
- Not an LLM merge gate. Models may propose truths. They do not decide the verdict.
- Not an IRIS org GitHub check. Do not copy the Action into `ignitetech-group` services for this trial.

## Executors

| If the fact is… | Executor |
| --- | --- |
| A bad shape in one language (`LIKE '%x%'`, nested `apiParams`) | `pattern` / `semgrep` |
| Ticket intent, local design, shared-shell review judgment | `coderabbit` (emit path instruction; compiler does not re-review) |
| Two sides must agree (Care `int_meta` is `Map<String,String>`) | `contract` |
| The customer can still do the thing (Generate Campaign) | `product` |
| A finished decision left a leftover gate | `decision` (scans checkout, not only the diff) |

Inclusive matching: path hit, coupling, always-on product catalog, and stale-decision scan.

## Status: local, warning-only trial

Not wired into any IRIS repository's CI, and it cannot fail a merge.
`docs/rollout.md` is the gate for changing that, and lists what has to be true
before any automatic trigger is enabled.

## Run it

```bash
npm ci
npm run check          # tests, typecheck, compile, build

# One checkout, diffed against its base (which is also the attribution base)
npm run assess -- --tenant iris --repo ignitetech-group/iris-web \
  --workspace /path/to/iris-web

# Or an explicit diff. --workspace is required either way.
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
| `fact_failed` | The truth held at base and fails at head, or the evidence is a line this change added. The author's to fix. |
| `preexisting_fact_failed` | The truth fails at base too. Needs an owner and a ticket, not a fix in this branch. |
| `unattributed_fact_failed` | The truth fails, but no base state was available, so nobody can say who caused it. Re-run with a base. |
| `advisory_fact_failed` | Only non-blocking truths failed. Informational. |
| `not_evaluated` | A truth could not be run. A configuration problem, not a regression. |
| `selected_truths_hold` | The selected truths were checked and hold. Not a statement about uncovered files. |
| `only_delegated` | Truths were selected but all were handed to CodeRabbit. Nothing was verified. |
| `no_selected_truth` | No live truth applied. Not a safety assertion. |

Attribution needs a base state. Local mode supplies it from the merge base
automatically, and PR mode from GitHub's base SHA; otherwise pass `--base-ref`.
Without one, a workspace failure is `unknown` and never gating — the tool will
not guess who caused it.

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
Visible gaps stay visible: `IRIS-TRUTH-0016` (live LIQL) and `IRIS-TRUTH-0017`
(Publisher AI). They are unfinished coverage, not disabled features, and they
are reported on every assessment.

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

## GitHub Action (not the team trial)

The Action in this repository is part of the product surface and stays compiled. The team trial does not install it on IRIS services. If you run it later, pin a SHA, use `enforcement: warning` until `0003` and `0009` are true, and never use privileged `pull_request_target` with only a diff.
