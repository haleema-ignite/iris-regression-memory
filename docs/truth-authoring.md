# Authoring truths

A truth is allowed into `live` only when it is falsifiable, cited, scoped, and routed to the cheapest correct executor.

## Required fields

- `statement` — the fact that must remain true
- `executor.kind` — `pattern`, `product`, `contract`, `decision`, `semgrep`, or `coderabbit`
- `applies_to.repositories` — GitHub `owner/name` or `*`
- `evidence` — issue key, RCA, e2e case, or public doc
- `governance.owner` — role, not a person (`publisher-maintainers`)

## Routing

- If Semgrep can see it, set `emit: semgrep` and a `forbidden_line_pattern`. Do not also write a CodeRabbit essay about the same pattern.
- If CodeRabbit should nag review intent, use `kind: coderabbit`. The compiler will not LLM-judge that class.
- If the customer can still do the thing, use `kind: product` with `files` + `must_contain`, and bind it to a blocking path (see `IRIS-TRUTH-0003`).
- If the dangerous file is often not in the PR, use `kind: decision` and `scan_workspace: true`.
- If two consumers must agree, use `kind: contract`.
- If a required guard must exist in scoped files (not only “was not removed in this hunk”), set `require_present: true`. Prove it against `--workspace`; new files can be proven from the diff alone.
- If a SQL shape is a reintroduction check, set `mode: added_lines`. Use `query_allow_if` for historical joins and explicit includeDeleted lookups. Do not scan every pre-existing query in a touched file.

## Status

1. `gap` — we know the class and cannot prove it yet
2. `proposed` — drafted, cannot fail
3. `live` — blocking or advisory according to `executor.blocking`
4. `superseded` / `deprecated` — ignored

## Public hygiene

No customer data, credentials, Slack dumps, or personal names.
