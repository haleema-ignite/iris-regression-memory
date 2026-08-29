# Stakeholder message

I built an advisory review layer for regressions that compile cleanly but recreate an IRIS-specific production failure.

It converts confirmed incidents into sanitized, approved behavioral contracts and checks pull-request diffs for explicit failure signals or removed guards. Similarity alone cannot fail. No applicable contract is reported as inconclusive, and partial file coverage is visible.

The current product includes a reusable GitHub Action, CLI with JSON and SARIF, a read-only local MCP server, schema-governed contracts, and forward/reverse historical replays. The proposed rollout is warning-only first, followed by contract-level precision measurement before any required enforcement.

The requested review is whether this is the right governance and rollout shape: role ownership, public sanitization rules, warning-mode telemetry, and the threshold for promoting an individual contract to blocking.
