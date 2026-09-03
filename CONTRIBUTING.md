# Contributing

Run `npm run check` before opening a pull request.

New live truths need a failing fixture, a safe neighbor, a role owner, and a review date. Choose the cheapest correct executor. Do not add an LLM judge.

Keep the repository identity-neutral and public-safe.

Signals must be real code tokens. Grep the target repository first: a signal that
is an English description of the failure (`fail open`, `skip persistState`) can
only match a fixture written to contain it, and makes the registry report
coverage that does not exist. See `docs/truth-authoring.md`.

Prefer demoting a truth to `gap` over keeping a check whose guard does not exist
in the code. A gap is honest; a live truth that fails every pull request is not.

`docs/rollout.md` is the gate for CI integration. The trial stays local and
warning-only until the items listed there have answers.
