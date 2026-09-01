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

`trial:local` runs unit tests, typecheck, emitter compile, build, `list`, a **checkout assess** of each present IRIS service (product + leftover facts on the tree), a **working-tree assess** vs `main`/`master`, and the 32-case historical benchmark. Use `--skip-check` or `--skip-benchmark` only if you are iterating on one slice. `--strict` fails the script on working-tree findings; by default those are your branch, not a broken compiler.

Current IRIS HEAD still violates two live facts. Seeing them is the full trial, not a broken install:

- `iris-web`: `IRIS-TRUTH-0003` — QA promotion still greps only `IRISNG-188[45]`
- `iris-api`: `IRIS-TRUTH-0009` — Marketing Meta shared mode still requires `SOCIALGATEWAY_*`

`trial:local` treats those two as expected until the facts become true. Any other blocking failure is unexpected.

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

Visible gaps stay visible: `IRIS-TRUTH-0016` (live LIQL) and `IRIS-TRUTH-0017` (Publisher AI). They are unfinished coverage, not disabled features.

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
```

A truth is `live` (can fail), `proposed` (human has not accepted it), or `gap` (unfinished coverage, still visible).

## Safety

Public truths contain issue keys, paths, and technical invariants. They must not contain customer data, credentials, copied Slack, or personal attribution.

## GitHub Action (not the team trial)

The Action in this repository is part of the product surface and stays compiled. The team trial does not install it on IRIS services. If you run it later, pin a SHA, use `enforcement: warning` until `0003` and `0009` are true, and never use privileged `pull_request_target` with only a diff.
