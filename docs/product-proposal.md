# Product proposal: IRIS Regression Memory

## Problem

Conventional review catches syntax, type, security, and local correctness defects. It is weaker at changes that are technically valid but recreate an IRIS-specific production failure: an unstable idempotency key, an unbounded replay window, a single-secret assumption during rotation, or a modern value written into a legacy enum.

The missing artifact is not another general reviewer. It is a small, governed memory of behavior that the system must preserve.

## Product shape

The deliverable is one deterministic engine with several thin interfaces:

- a reusable GitHub Action for sticky comments and Check Runs;
- a CLI for local replay, CI, JSON, and SARIF;
- a read-only local MCP server for developer tools and agents;
- a versioned contract registry with schema validation and ownership roles;
- a historical replay suite proving that known fixes pass and their reversals fail.

The first release is advisory. A detected regression produces a neutral check in `warning` mode. A blocking registry can use `error` mode only after measured precision and explicit approval from every contract owner represented in that registry.

## Decision boundary

The engine is intentionally narrower than semantic review. It does not infer a failure from prose similarity. A failure requires an approved contract, repository match, production-path match, and explicit line-level evidence. Retrieval helps find candidates; deterministic adjudication decides the result.

The engine distinguishes:

- a detected historical regression;
- no detected regression among applicable contracts;
- no applicable contract.

It also reports uncovered production files so partial coverage cannot be mistaken for whole-PR safety.

## Initial evidence

The sanitized replay suite covers three materially different incident classes:

| Incident class | Forward fix | Exact reverse or culprit |
| --- | --- | --- |
| Mixed Meta webhook signatures | no known regression | detected |
| Instagram restart watermark and comment floor | no known regression | detected |
| Shared Care legacy-enum compatibility | no known regression | detected |

These cases are executable fixtures in `fixtures/replay/` and run on every change.

## Rollout

1. Run the Action in warning mode on the two repositories represented by the initial contracts.
2. Record false positives, false negatives, uncovered paths, and contract-level hit rates for several weeks.
3. Repair or deprecate noisy contracts; add contracts only from confirmed incidents with a fixing or culprit diff.
4. Split any blocking subset into an approved registry and enable error mode only for that deliberately scoped set.
5. Add incident-to-draft extraction later as a private workflow. Keep approval and public sanitization human-controlled.

## Explicit non-goals

- general code-quality review;
- automatic contract approval;
- copying incident conversations into a public repository;
- using embeddings or model confidence as blocking evidence;
- replacing tests, observability, canaries, or rollback controls.

## Success criteria

- Known culprit/reverse fixtures are caught with line-level evidence.
- Corresponding fixes and safe nearby changes do not fail.
- No-applicable-contract is never rendered as pass.
- Every blocking contract has an owner role, expiry review date, and replay test.
- Warning-mode telemetry demonstrates acceptable precision before any required check is enabled.
