# Architecture

```text
tenant + catalogs + truths
        |
        v
PR diff + checkout (workspace)
        |
        v
inclusive match (path, coupling, product catalog, stale decision)
        |
        v
executor (pattern | product | contract | decision | semgrep | coderabbit)
        |
        v
assessment + visible gaps
   /        |         \
Markdown   SARIF     Semgrep/CodeRabbit emitters
```

The GitHub Action loads the registry from `GITHUB_ACTION_PATH` (this repository) and proves workspace facts against `GITHUB_WORKSPACE` (the service under review).

LLM is not on the verdict path.
