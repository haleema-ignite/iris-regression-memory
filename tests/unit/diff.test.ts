import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnifiedDiff, stripSandboxPrefix } from "../../src/diff.ts";

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

  it("keeps a removed line whose own content starts with --", () => {
    // Classifying by prefix without tracking hunk boundaries made a removed
    // `-- legacy comment` look like a `---` file header and dropped it. SQL is
    // exactly the domain these truths care about.
    const diff = parseUnifiedDiff(`diff --git a/q.sql b/q.sql
--- a/q.sql
+++ b/q.sql
@@ -1,2 +1,1 @@
--- legacy comment
 SELECT 1;
`);
    assert.deepEqual(diff.files[0]?.removedLines, ["-- legacy comment"]);
  });

  it("infers status from the header, not from content that looks like a header", () => {
    // `chunk.includes("deleted file mode")` matched an *added line* containing
    // that text, which set the status to deleted and made the reconstructed
    // after-state empty.
    const diff = parseUnifiedDiff(`diff --git a/notes.ts b/notes.ts
--- a/notes.ts
+++ b/notes.ts
@@ -1,1 +1,2 @@
 const a = 1;
+const doc = "deleted file mode 100644";
`);
    assert.equal(diff.files[0]?.status, "modified");
  });

  it("still recognises a genuinely deleted file", () => {
    const diff = parseUnifiedDiff(`diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-const a = 1;
`);
    assert.equal(diff.files[0]?.status, "deleted");
  });

  it("collects every hunk in a multi-hunk file", () => {
    const diff = parseUnifiedDiff(`diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-first old
+first new
@@ -40,2 +40,2 @@
-second old
+second new
`);
    assert.deepEqual(diff.files[0]?.addedLines, ["first new", "second new"]);
    assert.deepEqual(diff.files[0]?.removedLines, ["first old", "second old"]);
  });
});
