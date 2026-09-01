import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileRegistry } from "../../src/compile.ts";
import { loadRegistry } from "../../src/registry.ts";

describe("compile emitters", () => {
  it("emits Semgrep rules only for truths that belong on Semgrep", () => {
    const compiled = compileRegistry(loadRegistry("iris"));
    assert.match(compiled.semgrep, /IRIS-TRUTH-0019/);
    assert.match(compiled.semgrep, /IRIS-TRUTH-0006/);
    assert.match(compiled.semgrep, /LIKE/);
    assert.doesNotMatch(compiled.semgrep, /IRIS-TRUTH-0001/);
  });

  it("emits CodeRabbit path instructions and does not invent a second reviewer", () => {
    const compiled = compileRegistry(loadRegistry("iris"));
    assert.match(compiled.coderabbit, /IRIS-TRUTH-0018/);
    assert.match(compiled.coderabbit, /PublisherCalendarHeader/);
    assert.match(compiled.manifest, /Do not use these files as a second AI reviewer/);
  });
});
