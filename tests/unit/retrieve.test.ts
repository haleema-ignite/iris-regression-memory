import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnifiedDiff, stripSandboxPrefix } from "../../src/diff.ts";
import { retrieve } from "../../src/retrieve.ts";
import { loadContracts } from "../../src/contracts.ts";

describe("diff parsing", () => {
  it("collects added and removed lines", () => {
    const diff = parseUnifiedDiff(`diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-old
+new
`);
    assert.equal(diff.files[0]?.path, "foo.ts");
    assert.deepEqual(diff.files[0]?.removedLines, ["old"]);
    assert.deepEqual(diff.files[0]?.addedLines, ["new"]);
  });

  it("strips fixtures/sandbox prefix", () => {
    assert.equal(
      stripSandboxPrefix("fixtures/sandbox/engines/facebook/src/webhook/webhook.component.ts"),
      "engines/facebook/src/webhook/webhook.component.ts",
    );
  });
});

describe("retrieval", () => {
  it("returns at most three contracts", () => {
    const contracts = loadContracts();
    const diff = parseUnifiedDiff(`diff --git a/engines/facebook/src/webhook/webhook.component.ts b/engines/facebook/src/webhook/webhook.component.ts
--- a/engines/facebook/src/webhook/webhook.component.ts
+++ b/engines/facebook/src/webhook/webhook.component.ts
@@ -1 +1,2 @@
+hasSeen
+timingSafeEqual
+authState
+getMessagingUserProfile
`);
    const hits = retrieve(contracts, "ignitetech-group/iris-sp-engines", diff, 3);
    assert.ok(hits.length <= 3);
    assert.ok(hits.every((hit) => hit.pathMatched || hit.interfaceMatched));
  });
});
