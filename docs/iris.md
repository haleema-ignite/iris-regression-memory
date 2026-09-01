# IRIS tenant zero

IRIS is the first tenant, not a hardcoded product. Truths live in `tenants/iris/`.

## First facts

| Id | Fact | Executor | Incident |
| --- | --- | --- | --- |
| 0001 / 0002 | Generate Campaign visible and wired | product | calendar/assets regressions |
| 0003 | QA promotion grep is not only IRISNG-1884/1885 | product | P14 drawer |
| 0004 | iris-e2e keeps P14 | product | same |
| 0005 | Care enum allowlist | contract | IRISNG-3518 / 3599 |
| 0006 | `int_meta` is a flat string map | contract + Semgrep | IRISNG-4090 |
| 0007 | Durable Instagram watermarks | pattern | pod5 / IRISNG-3940 |
| 0008 | Enumeration mentions `int_deleted` | contract | IRISNG-3453 |
| 0009 | No leftover SOCIALGATEWAY Marketing Meta gate | decision | IRISNG-3905 |
| 0010–0015 | Migrated engine incident patterns | pattern | prior BEH contracts |
| 0012 | Hidden boards fail closed | pattern | IRISNG-3231 |
| 0016 | Live LIQL listing | **gap** | IRISNG-3231 mock≠API |
| 0017 | Publisher AI entry points | **gap** | Slack |
| 0018 | Calendar header path instruction | CodeRabbit emit | shared shell |
| 0019 | No `LIKE '%…%'` | Semgrep | pod5 |

## Wire-up

Add `examples/iris-service.yml` to each IRIS service. Product truths require the service checkout; do not run this Action as a privileged `pull_request_target` that only fetches a diff.
