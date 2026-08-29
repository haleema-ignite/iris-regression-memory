# Evaluation

The evaluation suite uses sanitized, minimal excerpts derived from historical diffs. It stores no authorship metadata, private conversations, credentials, or customer information.

| Replay | Repository | Expected result | Contract |
| --- | --- | --- | --- |
| Mixed-signature fix | `ignitetech-group/iris-sp-engines` | no known regression | `IRIS-BEH-0003` |
| Reverse of mixed-signature fix | `ignitetech-group/iris-sp-engines` | historical regression detected | `IRIS-BEH-0003` |
| Instagram watermark/comment-floor fix | `ignitetech-group/iris-sp-engines` | no known regression | `IRIS-BEH-0002` |
| Reverse of watermark/comment-floor fix | `ignitetech-group/iris-sp-engines` | historical regression detected | `IRIS-BEH-0002` |
| Legacy-incompatible shared-schema write | `ignitetech-group/iris-api` | historical regression detected | `IRIS-BEH-0007` |
| Legacy-compatible shared-schema write | `ignitetech-group/iris-api` | no known regression | `IRIS-BEH-0007` |

The suite also verifies all synthetic violations, safe-neighbor changes, repository isolation, excluded test paths, partial coverage, and interface-only retrieval behavior.

Run:

```bash
npm test
npm run typecheck
npm run build
```

Passing this suite demonstrates deterministic behavior for the encoded contracts. It does not demonstrate coverage of all IRIS regressions; uncovered files and missing incident classes remain explicit product metrics.
