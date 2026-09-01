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

## Run it

```bash
npm ci
npm test

# Local diff against the IRIS tenant
npm run assess -- --tenant iris --repo ignitetech-group/iris-web \
  --diff-file change.diff --workspace /path/to/iris-web --enforcement error

# Emit Semgrep rules and CodeRabbit path instructions
npm run compile
```

CLI exits nonzero for a failed **blocking** truth in `error` mode (the default). Use `--enforcement warning` only while wiring a new tenant.

## GitHub Action (IRIS-ready)

Copy `examples/iris-service.yml` into `iris-web`, `iris-api`, `iris-sp-engines`, and `iris-e2e`. The Action uses the **service checkout** as the workspace. Product and leftover-decision truths cannot be proven from a diff alone.

```yaml
- uses: haleema-ignite/iris-regression-memory@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    tenant: iris
    enforcement: error
```

### Current IRIS HEAD

Some live truths describe bugs that are **still in tree**. Adding the Action will fail until those facts become true:

- `IRIS-TRUTH-0003` — QA promotion still greps only `IRISNG-188[45]`, so Generate Campaign P14 is not on the blocking path.
- `IRIS-TRUTH-0009` — Marketing Meta shared mode still hard-requires `SOCIALGATEWAY_*` in `iris-api`.

That is the ratchet, not a false positive. Fix the fact or temporarily mark the truth `proposed` — do not delete it.

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

A truth is `live` (can fail), `proposed` (human has not accepted it), or `gap` (unfinished coverage, still visible). Gaps are not “out of scope.”

## Safety

Public truths contain issue keys, paths, and technical invariants. They must not contain customer data, credentials, copied Slack, or personal attribution.

## MCP

```bash
npm run build
node dist/mcp.cjs
```

Tools: `assess_diff`, `assess_pull_request`, `list_truths`, `get_truth`, `compile_emitters`.
