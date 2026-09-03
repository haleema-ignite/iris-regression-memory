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

  it("never fails a check for a pre-existing ratchet, even in error mode", () => {
    // Charging an author for a leftover they did not create is how a ratchet
    // becomes noise the team learns to ignore.
    assert.equal(
      checkConclusion("fail", "error", "full", "preexisting_fact_failed"),
      "neutral",
    );
    assert.equal(
      checkConclusion("fail", "error", "full", "fact_failed"),
      "failure",
    );
  });

  it("reports introduced and pre-existing failures under separate headings", () => {
    const assessment = assess({
      repo: "ignitetech-group/iris-web",
      diff: parseUnifiedDiff([
        "diff --git a/src/features/publishing/calendar/components/PublisherCalendarHeader.tsx b/src/features/publishing/calendar/components/PublisherCalendarHeader.tsx",
        "--- a/src/features/publishing/calendar/components/PublisherCalendarHeader.tsx",
        "+++ b/src/features/publishing/calendar/components/PublisherCalendarHeader.tsx",
        "@@ -1,3 +1,1 @@",
        "-      <button onClick={() => onGenerateCampaign?.()}>Generate Campaign</button>",
        "+      <button>Filters</button>",
      ].join("\n")),
      source: "mixed",
      registry,
      workspace: {
        root: "/memory",
        read: (path: string) => ({
          // The label survives only in a comment, and the promotion grep is the
          // standing 0003 ratchet.
          "src/features/publishing/calendar/components/PublisherCalendarHeader.tsx":
            "{/* Generate Campaign Button */}\n<button onClick={() => onGenerateCampaign?.()}>Filters</button>",
          "src/features/publishing/calendar/PublisherCalendarPage.tsx":
            "import { GenerateCampaignPanel } from './x';\n<PublisherCalendarHeader onGenerateCampaign={h} />\n<GenerateCampaignPanel />",
          ".github/workflows/qa001-deploy.yaml": "test_grep: 'IRISNG-188[45]'",
        })[path],
        list: () => [],
      },
      // At base the header still rendered the label and the promotion grep was
      // already blind, so the two failures land in different sections.
      baseWorkspace: {
        root: "/memory-base",
        read: (path: string) => ({
          "src/features/publishing/calendar/components/PublisherCalendarHeader.tsx":
            "<button onClick={() => onGenerateCampaign?.()}>Generate Campaign</button>",
          "src/features/publishing/calendar/PublisherCalendarPage.tsx":
            "import { GenerateCampaignPanel } from './x';\n<PublisherCalendarHeader onGenerateCampaign={h} />\n<GenerateCampaignPanel />",
          ".github/workflows/qa001-deploy.yaml": "test_grep: 'IRISNG-188[45]'",
        })[path],
        list: () => [],
      },
    });
    const markdown = renderMarkdown(assessment);
    assert.match(markdown, /FACT FAILED — introduced by this change/);
    assert.match(markdown, /## Introduced by this change/);
    assert.match(markdown, /## Pre-existing in this checkout/);
    assert.match(markdown, /not\s+this change's regressions/);
    // The narrower claim a product grep actually supports must be shown.
    assert.match(markdown, /Proves only:/);
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
