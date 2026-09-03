# IRIS tenant zero

IRIS is the first tenant, not a hardcoded product. Truths live in `tenants/iris/`.

## Live truths

| Id | Fact | Executor | Mode | Incident |
| --- | --- | --- | --- | --- |
| 0001 | Generate Campaign rendered on the calendar header | product | checkout | calendar/assets regressions |
| 0002 | Calendar page wires the panel and handler | product | checkout | same |
| 0003 | QA promotion grep names the covering e2e case | product | checkout | P14 drawer |
| 0004 | iris-e2e keeps P14 | product | checkout | same |
| 0005 | Care enum allowlist | contract | added lines | IRISNG-3518 / 3599 |
| 0006 | `int_meta` is a flat string map | contract + Semgrep | both | IRISNG-4090 |
| 0007 | Durable Instagram watermarks | pattern | added lines | pod5 / IRISNG-3940 |
| 0008 | Enumeration mentions `int_deleted` | contract | added lines | IRISNG-3453 |
| 0009 | No leftover SOCIALGATEWAY Marketing Meta gate | decision | checkout | IRISNG-3905 |
| 0010 | Meta event ingest stays idempotent | pattern | added lines | IRISNG-3975 |
| 0011 | Mixed Meta app webhook signatures verify | pattern | added lines | IRISNG-3905 |
| 0012 | Hidden community boards fail closed | pattern | checkout | IRISNG-3231 |
| 0013 | Facebook page auth failures isolated per page | pattern | added lines | IRISNG-4040 |
| 0014 | Instagram DM authors resolved, not raw IGSIDs | pattern | added lines | IRISNG-4026 |
| 0018 | Calendar header path instruction | CodeRabbit | delegated | shared shell |
| 0019 | No `LIKE '%…%'` on Care metadata | Semgrep | added lines | pod5 / CARESMM-24342 |

## Standing state, by branch

Every claim below names the branch it was verified on. A statement about "the
code" without a SHA is not a fact — see `docs/truth-authoring.md`.

| Truth | origin/main | origin/develop |
| --- | --- | --- |
| 0003 promotion grep | still `IRISNG-188[45]` — **fails** | no `test_grep` line — **fails** |
| 0009 SocialGateway gate | 2 occurrences — **fails** | 0 occurrences — **holds** |
| 0005 `provider: 'applebc'` | absent — holds | absent — holds |
| 0011 per-page secret guards | absent | present (PR 389) |
| 0012 board-visibility guards | present | present |

Verified at `origin/main` `9096fb2d` / `dbe8215a` / `8e02d6dc` and
`origin/develop` `b516fb58` / `2c7c03dc` / `88c9c1ca` for engines, api and web
respectively.

Two notes that matter for reading a report:

- `0005` does **not** currently fail anywhere. An earlier draft said it did;
  that reading came from a dirty local feature branch.
- `0011` passes on `origin/main` even though the guards are absent there,
  because it only inspects added lines. That is why its result is reported as
  "not reintroduced" rather than "holds" — see the proof-scope section in
  `docs/architecture.md`.

## Gaps — unfinished coverage, reported on every assessment

| Id | Fact | Why it is not live |
| --- | --- | --- |
| 0015 | Brand Messenger ingest idempotent on `doc_src_id` | Wrong scope. `doc_src_id` is a Care `doc_document` column written by iris-api, not by the engine; the string appears nowhere in `engines/brand-messenger`. Needs rescoping to the real writer. |
| 0016 | Live LIQL listing omits hidden boards | Needs a live LIQL probe. |
| 0017 | Publisher AI entry points reachable | No stable selector exists to name. |

## Proposals — observations needing an owner's decision

| Id | Observation |
| --- | --- |
| 0020 | `configureDualPublish` is called by 6 of 28 engines on `origin/main` and 8 of 29 on `origin/develop`. A truth requiring all of them would report ~22 failures on day one. Needs the list of genuinely dual-pipeline engines. (An earlier draft said "7 of 28" — a dirty-branch artefact matching neither.) |
| 0021 | `IRIS/CLAUDE.md` documents Kafka `sessionTimeout` 120000 / `rebalanceTimeout` 120000 / `heartbeatInterval` 5000. `sdk/src/kafka-consumer.ts` sets 10000 / 30000 / 3000. One is stale; encoding either without deciding would ratchet the wrong number into place. |


## Wire-up

Not yet wired to any IRIS repository. `docs/rollout.md` is the gate.

Product truths require the service checkout, so `--workspace` is mandatory and
the CLI refuses to run without it. Do not run this as a privileged
`pull_request_target` that only fetches a diff.
