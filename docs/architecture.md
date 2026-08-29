# Architecture

One assessment engine powers every interface:

```text
PR or unified diff
        |
        v
parse changed files and lines
        |
        v
retrieve repo/path/interface candidates
        |
        v
discard non-path-matched candidates for adjudication
        |
        v
approved status + path exclusions + explicit signal checks
        |
        v
assessment + coverage
   /       |        \
Markdown  JSON/SARIF  GitHub Check or MCP response
```

## Retrieval versus adjudication

Retrieval is deliberately permissive. Repository, glob, symbol, configuration, and topic anchors help locate potentially relevant contracts. Retrieval rank never changes the verdict.

Adjudication is deliberately strict. Only changed files matching a contract path are evaluated. Only an approved contract can fail. The evidence must be either an explicit violation signal on an added line or an explicit removal signal that disappears without replacement.

## Coverage

Coverage is computed over changed production files after excluding documentation, workflow files, lockfiles, and tests. It is independent of the verdict:

- `full`: every reviewable file matched at least one contract;
- `partial`: some did;
- `none`: none did.

This avoids converting a narrow contract match into a claim about unrelated files in the same pull request.

## Trust boundaries

- Contract YAML is validated before assessment.
- Public contracts contain sanitized technical facts only.
- GitHub access is read-only for diff collection; comments and Check Runs are the only writes made by the Action.
- The MCP server is read-only and local over stdio.
- Warning mode is the default for the Action.
- Contract extraction, approval, and enforcement are separate activities.
