import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileRegistry } from "../../src/compile.ts";
import { loadRegistry } from "../../src/registry.ts";

describe("compile emitters", () => {
  it("emits Semgrep rules only for truths that belong on Semgrep", () => {
    const compiled = compileRegistry(loadRegistry("iris"));
    assert.match(compiled.semgrep, /IRIS-TRUTH-0006/);
    assert.match(compiled.semgrep, /intMetaOverride/);
    assert.doesNotMatch(compiled.semgrep, /IRIS-TRUTH-0001/);
  });

  it("keeps added-lines truths out of the whole-checkout ruleset", () => {
    // Semgrep pattern-regex matches entire files. IRIS-TRUTH-0019 only claims
    // added lines, and iris-api holds 78 pre-existing leading-wildcard LIKEs
    // across 11 files, so emitting it as an ordinary rule would raise all 78 as
    // errors while the truth says it is not a ratchet.
    const compiled = compileRegistry(loadRegistry("iris"));
    assert.doesNotMatch(compiled.semgrep, /IRIS-TRUTH-0019/);
    assert.match(compiled.semgrepDiffScan, /IRIS-TRUTH-0019/);
    assert.match(compiled.semgrepDiffScan, /LIKE/);
    assert.match(compiled.semgrepDiffScan, /requires_diff_scan/);
    assert.match(compiled.semgrepDiffScan, /--baseline-commit/);
    assert.match(compiled.manifest, /diff scan only/);
  });

  it("reports nothing as unemittable, because unemittable live truths are rejected at load", () => {
    const compiled = compileRegistry(loadRegistry("iris"));
    assert.deepEqual(compiled.unemittable, []);
  });

  it("emits CodeRabbit path instructions and does not invent a second reviewer", () => {
    const compiled = compileRegistry(loadRegistry("iris"));
    assert.match(compiled.coderabbit, /IRIS-TRUTH-0018/);
    assert.match(compiled.coderabbit, /PublisherCalendarHeader/);
    assert.match(compiled.manifest, /Do not use these files as a second AI reviewer/);
  });
});
