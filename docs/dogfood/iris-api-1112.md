<!-- iris-regression-memory -->
# IRIS Behavioral Regression

**Verdict:** PASS
**Repo:** ignitetech-group/iris-api
**PR:** 1112
**SHA:** `ac2688f9d1d146d30c0daaabafa279ffcbf7ff7e`
**Source:** ignitetech-group/iris-api#1112@ac2688f
**Contracts loaded:** 6
**Retrieved:** IRIS-BEH-0004

## Findings

### IRIS-BEH-0004 — PASS
**Isolate Facebook page auth failures per page**

Applies to this change, but the required guards remain and no violation signal was added.

- Evidence: applicable without violation
- Required guard: per-page authState with skip only for the blocked page
- Incident: IRISNG-4040, https://github.com/ignitetech-group/iris-sp-engines/pull/413, https://github.com/ignitetech-group/iris-api/pull/1112

_Semantic similarity alone cannot fail. Failures require a violation signal in added lines or a removed guard._
