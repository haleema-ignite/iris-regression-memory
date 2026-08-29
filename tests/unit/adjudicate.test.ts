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
      violation_signal_groups: [],
      violation_line_patterns: [],
      removal_signals: ["hasSeen"],
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
    matchedPaths: ["engines/facebook/src/a.ts"],
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

  it("fails when every member of a violation group is added in one matched file", () => {
    const item = contract({
      applicability: {
        strong_anchors: ["authOk"],
        violation_signals: [],
        violation_signal_groups: [["if (authOk)", "markAuthDegraded", "components not started"]],
        removal_signals: [],
        confidence: "high",
      },
    });
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1,4 @@
 keepPublishing();
+if (authOk) startAll();
+markAuthDegraded(reason);
+logger.warn("components not started");
`);
    const finding = adjudicate(hitFor(item), diff);
    assert.equal(finding.verdict, "fail");
    assert.equal(finding.evidence.kind, "violation_signal_group");
  });

  it("does not match a partial violation group", () => {
    const item = contract({
      applicability: {
        strong_anchors: ["authOk"],
        violation_signals: [],
        violation_signal_groups: [["if (authOk)", "markAuthDegraded", "components not started"]],
        removal_signals: [],
        confidence: "high",
      },
    });
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1,3 @@
 keepPublishing();
+if (authOk) startAll();
+markAuthDegraded(reason);
`);
    assert.equal(adjudicate(hitFor(item), diff).verdict, "pass");
  });

  it("does not combine violation group members across files", () => {
    const item = contract({
      applicability: {
        strong_anchors: ["authOk"],
        violation_signals: [],
        violation_signal_groups: [["if (authOk)", "markAuthDegraded"]],
        removal_signals: [],
        confidence: "high",
      },
    });
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1,2 @@
 keepPublishing();
+if (authOk) startAll();
diff --git a/engines/facebook/src/b.ts b/engines/facebook/src/b.ts
--- a/engines/facebook/src/b.ts
+++ b/engines/facebook/src/b.ts
@@ -1 +1,2 @@
 keepPolling();
+markAuthDegraded(reason);
`);
    assert.equal(adjudicate(hitFor(item), diff).verdict, "pass");
  });

  it("fails when an added line matches a structural violation pattern", () => {
    const item = contract({
      applicability: {
        strong_anchors: ["persistState"],
        violation_signals: [],
        violation_signal_groups: [],
        violation_line_patterns: [
          String.raw`persistState\s*\(\s*account\s*,\s*['"]comments['"]\s*,\s*\{\s*seenIds\s*:[^,}]+\}\s*\)`,
        ],
        removal_signals: [],
        confidence: "high",
      },
    });
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1,2 @@
 keepPublishing();
+await this.persistState(account, 'comments', { seenIds: newSeenIds });
`);
    const finding = adjudicate(hitFor(item), diff);
    assert.equal(finding.verdict, "fail");
    assert.equal(finding.evidence.kind, "violation_line_pattern");
  });

  it("does not match comment persistence when a bounded watermark is included", () => {
    const item = contract({
      applicability: {
        strong_anchors: ["persistState"],
        violation_signals: [],
        violation_signal_groups: [],
        violation_line_patterns: [
          String.raw`persistState\s*\(\s*account\s*,\s*['"]comments['"]\s*,\s*\{\s*seenIds\s*:[^,}]+\}\s*\)`,
        ],
        removal_signals: [],
        confidence: "high",
      },
    });
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1 +1,2 @@
 keepPublishing();
+await this.persistState(account, 'comments', { seenIds: newSeenIds, watermark: commentsFloor });
`);
    assert.equal(adjudicate(hitFor(item), diff).verdict, "pass");
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

  it("fails only on an explicit removal signal", () => {
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1,2 +1 @@
-if (hasSeen(id)) return;
 keepPublishing();
`);
    const finding = adjudicate(hitFor(contract()), diff);
    assert.equal(finding.verdict, "fail");
    assert.equal(finding.evidence.kind, "guard_removed");
  });

  it("does not fail when the same guard remains in context", () => {
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1,3 +1,2 @@
-if (hasSeen(oldId)) return;
 if (hasSeen(currentId)) return;
 keepPublishing();
`);
    const finding = adjudicate(hitFor(contract()), diff);
    assert.equal(finding.verdict, "pass");
  });

  it("does not treat a retrieval symbol as a removable guard", () => {
    const item = contract({
      applicability: {
        strong_anchors: ["hasSeen", "IGSID"],
        violation_signals: ["Date.now() as dedup"],
        removal_signals: ["hasSeen"],
        confidence: "high",
      },
      scope: {
        repositories: ["ignitetech-group/iris-sp-engines"],
        paths: ["engines/facebook/**"],
        symbols: ["hasSeen", "IGSID"],
      },
    });
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/a.ts b/engines/facebook/src/a.ts
--- a/engines/facebook/src/a.ts
+++ b/engines/facebook/src/a.ts
@@ -1,2 +1 @@
-const label = "IGSID";
 keepPublishing();
`);
    assert.equal(adjudicate(hitFor(item), diff).verdict, "pass");
  });
});
