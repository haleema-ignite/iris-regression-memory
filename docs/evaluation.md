# Evaluation

Unit tests replay sanitized historical diffs and new executor fixtures:

- pattern reversals of Meta signatures, Instagram watermarks, Care enum writes
- product: Generate Campaign missing vs present, promotion grep trap
- contract: nested `int_meta` including `intMetaOverride.apiParams = {`, `int_deleted` dropped vs dynamic/historical joins, fail-open boards, community introduction with no board filter
- decision: leftover SocialGateway gate outside the diff
- reintroduction vs leftover: `0008`/`0019` fail on added lines; `0009` still scans the checkout
- workspace walker: dangling symlinks are skipped
- compile: Semgrep rules and CodeRabbit fragments, no product-truth Semgrep spam

```bash
npm test
npm run typecheck
npm run compile
npm run build
```

A pass means the encoded facts behave. It does not mean every IRIS regression is covered. Visible `gap` truths are the unfinished list.
