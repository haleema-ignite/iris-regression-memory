<!-- iris-regression-memory -->
# IRIS Behavioral Regression

**Verdict:** PASS
**Repo:** ignitetech-group/iris-sp-engines
**PR:** 389
**SHA:** `dafd0a55772b8bfd9bc16a6fa0f7f41c0e30b01f`
**Source:** ignitetech-group/iris-sp-engines#389@dafd0a5
**Contracts loaded:** 6
**Retrieved:** IRIS-BEH-0003, IRIS-BEH-0001, IRIS-BEH-0005

## Findings

### IRIS-BEH-0003 — PASS
**Accept mixed Meta app webhook signatures during rotation**

Applies to this change, but the required guards remain and no violation signal was added.

- Evidence: applicable without violation
- Required guard: verify HMAC against the page or account app secret when present
- Incident: IRISNG-3905, https://github.com/ignitetech-group/iris-sp-engines/pull/389

### IRIS-BEH-0001 — PASS
**Preserve idempotency when retrying inbound Meta events**

Applies to this change, but the required guards remain and no violation signal was added.

- Evidence: applicable without violation
- Required guard: stable idempotency key based on the platform event ID
- Incident: IRISNG-3975

### IRIS-BEH-0005 — PASS
**Resolve Instagram DM author profiles instead of numeric IGSIDs**

Applies to this change, but the required guards remain and no violation signal was added.

- Evidence: applicable without violation
- Required guard: resolve messaging user profile before publish
- Incident: IRISNG-4026, https://github.com/ignitetech-group/iris-sp-engines/pull/408

_Semantic similarity alone cannot fail. Failures require a violation signal in added lines or a removed guard._
