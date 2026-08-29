<!-- iris-regression-memory -->
# IRIS Behavioral Regression

**Verdict:** PASS
**Repo:** ignitetech-group/iris-sp-engines
**PR:** 413
**SHA:** `2ffcd05773a48d3c0db89f32d94d2037d9c38233`
**Source:** ignitetech-group/iris-sp-engines#413@2ffcd05
**Contracts loaded:** 6
**Retrieved:** IRIS-BEH-0004, IRIS-BEH-0001

## Findings

### IRIS-BEH-0004 — PASS
**Isolate Facebook page auth failures per page**

Applies to this change, but the required guards remain and no violation signal was added.

- Evidence: applicable without violation
- Required guard: per-page authState with skip only for the blocked page
- Incident: IRISNG-4040, https://github.com/ignitetech-group/iris-sp-engines/pull/413, https://github.com/ignitetech-group/iris-api/pull/1112

### IRIS-BEH-0001 — PASS
**Preserve idempotency when retrying inbound Meta events**

Applies to this change, but the required guards remain and no violation signal was added.

- Evidence: applicable without violation
- Required guard: stable idempotency key based on the platform event ID
- Incident: IRISNG-3975

_Semantic similarity alone cannot fail. Failures require a violation signal in added lines or a removed guard._
