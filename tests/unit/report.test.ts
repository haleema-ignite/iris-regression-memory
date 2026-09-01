import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assess } from "../../src/assess.ts";
import { parseUnifiedDiff } from "../../src/diff.ts";
import { loadRegistry } from "../../src/registry.ts";
import { checkConclusion, renderMarkdown } from "../../src/report.ts";
import { renderSarif } from "../../src/sarif.ts";

const registry = loadRegistry("iris");

function replay(name: string) {
  const raw = readFileSync(new URL(`../../fixtures/replay/${name}`, import.meta.url), "utf8");
  return assess({
    repo: "ignitetech-group/iris-sp-engines",
    diff: parseUnifiedDiff(raw),
    source: name,
    registry,
  });
}

describe("report adapters", () => {
  it("keeps detected facts neutral in warning mode and failing in error mode", () => {
    assert.equal(checkConclusion("fail", "warning"), "neutral");
    assert.equal(checkConclusion("fail", "error"), "failure");
    assert.equal(checkConclusion("inconclusive", "error"), "neutral");
    assert.equal(checkConclusion("pass", "warning", "partial"), "neutral");
    assert.equal(checkConclusion("pass", "warning", "full"), "success");
  });

  it("renders fact ids instead of a general review essay", () => {
    const assessment = replay("meta-signature-fix-forward.diff");
    const markdown = renderMarkdown(assessment);
    assert.match(markdown, /SELECTED TRUTHS HOLD/);
    assert.match(markdown, /does not LLM-judge/);
  });

  it("emits one SARIF result for the failed truth", () => {
    const sarif = renderSarif(replay("meta-signature-fix-reverse.diff")) as {
      version: string;
      runs: Array<{ results: Array<{ ruleId: string; level: string }> }>;
    };
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results.length, 1);
    assert.equal(sarif.runs[0]?.results[0]?.ruleId, "IRIS-TRUTH-0011");
    assert.equal(sarif.runs[0]?.results[0]?.level, "error");
  });
});
