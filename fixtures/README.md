# Fixtures

Hand-written diffs and workspaces used by `tests/unit`. The real-history cases
live in `benchmarks/iris-historical.json` and are replayed from immutable SHAs in
local IRIS checkouts; these fixtures cover the executor mechanics around them.

## Write fixtures that look like the repository

A fixture must be code someone would actually write. The first draft of this
registry had several truths whose signals were English descriptions of a failure
— `fail open`, `treat missing board as visible`, `skip persistState` — and the
fixtures were written to contain those phrases so the checks would fire:

```ts
// fixtures/workspaces/community-ok/.../polling.component.ts
if (!post.board) return "fail closed";
```

No real TypeScript returns the string `"fail closed"`. Those cases passed in the
benchmark and failed on every real pull request that touched the same path,
because the phrase exists in the fixture and nowhere in `iris-sp-engines`. A
fixture written against the matcher validates the matcher against itself.

Before adding a fixture, grep the real repository for the token you are matching.
If it is not there, fix the truth, not the fixture.

## Currently unused

These are retained for reference but no test reads them. They were written for
truths that have since been demoted to `gap`, because the guards they assert do
not exist in the real repositories:

| Fixture | Was for | Why unused |
| --- | --- | --- |
| `diffs/hidden-board-fail-open.diff` | `IRIS-TRUTH-0012` | Matched the prose signals `treat missing board as visible` and `fail open`. 0012 is now a gap. |
| `diffs/community-log-only.diff` | `IRIS-TRUTH-0012` | Paired negative case. |
| `positive/unstable-doc-src-id.diff` | `IRIS-TRUTH-0015` | 0015 was scoped to `engines/brand-messenger`, which never writes `doc_src_id`. Now a gap pending rescoping to the iris-api writer. |

`workspaces/community-ok/` and `sandbox/engines/brand-messenger/src/ingest.ts`
are in the same category. `ingest.ts` does not correspond to any file in
`iris-sp-engines`.

They are kept rather than deleted so the demotions in `docs/iris.md` can be read
against what they were originally validated on. Delete them once those truths are
either rewritten or dropped.
