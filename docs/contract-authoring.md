# Contract authoring guide

Create a contract only for a confirmed behavior that caused or could directly recreate a production incident. Start from the culprit and fixing diffs, not from incident prose alone.

## Required evidence

- a stable issue key or pull-request reference;
- the invariant that must remain true;
- the concrete failure mechanism;
- narrow repository and production-path scopes;
- explicit violation or removal signals visible in a diff;
- a role-based owner and review date;
- a positive replay and a nearby safe replay.

## Signal quality

Prefer distinctive code fragments or guard symbols. Avoid broad words such as `token`, `id`, `config`, or `provider`. A removal signal should name the historical guard itself, not every symbol used for retrieval.

Signals are case-insensitive literal matches. They are not regular expressions and should never contain secrets or customer values.

## Lifecycle

1. Draft the contract as `extracted` or `reviewed`; those statuses cannot fail.
2. Add forward, reverse, and safe-neighbor fixtures.
3. Review technical accuracy, sanitization, scope, and false-positive risk.
4. Mark it `approved` only after the owner role accepts enforcement semantics.
5. Run in warning mode and inspect real matches.
6. Revise, supersede, deprecate, or renew it by `review_after`.

## Public-repository hygiene

Do not include names of employees, customers, tenants, channels, credentials, copied messages, private URLs, or internal hostnames. Use issue keys, pull-request numbers, role names, and technical descriptions. Run the repository hygiene check before publishing a change.

## Review checklist

- Would the exact historical culprit trigger?
- Would the corresponding fix avoid triggering?
- Does a safe change in the same file avoid triggering?
- Are test paths excluded?
- Is every removal signal narrow enough to justify a warning?
- Is the failure mechanism understandable without private incident context?
- Does the contract expire for review?
