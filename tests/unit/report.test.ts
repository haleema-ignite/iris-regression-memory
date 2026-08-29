import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assess } from "../../src/assess.ts";
import { loadContracts } from "../../src/contracts.ts";
import { parseUnifiedDiff } from "../../src/diff.ts";
import { checkConclusion, renderMarkdown } from "../../src/report.ts";
import { renderSarif } from "../../src/sarif.ts";

const contracts = loadContracts();

function replay(name: string) {
  const raw = readFileSync(new URL(`../../fixtures/replay/${name}`, import.meta.url), "utf8");
  return assess({
    repo: "ignitetech-group/iris-sp-engines",
    diff: parseUnifiedDiff(raw),
    source: name,
    contracts,
  });
}

describe("report adapters", () => {
  it("keeps detected regressions neutral in warning mode and failing in error mode", () => {
    assert.equal(checkConclusion("fail", "warning"), "neutral");
    assert.equal(checkConclusion("fail", "error"), "failure");
    assert.equal(checkConclusion("inconclusive", "error"), "neutral");
    assert.equal(checkConclusion("pass", "warning", "partial"), "neutral");
    assert.equal(checkConclusion("pass", "warning", "full"), "success");
  });

  it("renders a precise non-safety assertion", () => {
    const assessment = replay("meta-signature-fix-forward.diff");
    const markdown = renderMarkdown(assessment);
    assert.match(markdown, /NO KNOWN REGRESSION/);
    assert.match(markdown, /Semantic similarity alone cannot fail/);
  });

  it("emits one SARIF result for the detected historical contract", () => {
    const sarif = renderSarif(replay("meta-signature-fix-reverse.diff")) as {
      version: string;
      runs: Array<{ results: Array<{ ruleId: string; level: string }> }>;
    };
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0]?.results.length, 1);
    assert.equal(sarif.runs[0]?.results[0]?.ruleId, "IRIS-BEH-0003");
    assert.equal(sarif.runs[0]?.results[0]?.level, "warning");
  });
});
