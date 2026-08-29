import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adjudicate } from "../../src/adjudicate.ts";
import { parseUnifiedDiff } from "../../src/diff.ts";
import type { BehavioralContract } from "../../src/types.ts";
import type { RetrievalHit } from "../../src/retrieve.ts";

function contract(overrides: Partial<BehavioralContract> = {}): BehavioralContract {
  return {
    id: "IRIS-BEH-0001",
    title: "Test contract",
    status: "approved",
    scope: {
      repositories: ["ignitetech-group/iris-sp-engines"],
      paths: ["engines/facebook/**"],
      symbols: ["hasSeen"],
    },
    incident: { references: [{ type: "jira", key: "IRISNG-0000" }] },
    behavior: {
      invariant: "Do not publish duplicates.",
      failure_mechanism: "Unstable identity on retry.",
    },
    applicability: {
      strong_anchors: ["hasSeen"],
      violation_signals: ["Date.now() as dedup"],
      confidence: "high",
    },
    required_guards: ["stable idempotency key"],
    governance: { owner: "social-platform-team", version: 1 },
    ...overrides,
  };
}

function hitFor(item: BehavioralContract): RetrievalHit {
  return {
    contract: item,
    score: 11,
    pathMatched: true,
    interfaceMatched: true,
    hits: ["hasSeen"],
  };
}

describe("adjudication", () => {
  it("never fails a non-approved contract", () => {
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1 @@
+Date.now() as dedup
`);
    const finding = adjudicate(hitFor(contract({ status: "extracted" })), diff);
    assert.equal(finding.verdict, "pass");
  });

  it("fails on a violation signal in added lines", () => {
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1 @@
+Date.now() as dedup
`);
    const finding = adjudicate(hitFor(contract()), diff);
    assert.equal(finding.verdict, "fail");
    assert.equal(finding.evidence.kind, "violation_signal");
  });

  it("does not fail on semantic-looking comments without a signal", () => {
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1,2 @@
     if (this.hasSeen(id)) return;
+    // maybe this is similar to a historical incident
`);
    const finding = adjudicate(hitFor(contract()), diff);
    assert.equal(finding.verdict, "pass");
  });
});
