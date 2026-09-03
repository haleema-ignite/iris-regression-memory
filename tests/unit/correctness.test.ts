/**
 * Regression tests for the correctness defects found while reviewing the trial
 * registry against the real IRIS checkouts. Each block names the defect it pins
 * down, so a future change that reintroduces one fails here rather than in a
 * pull request comment six months from now.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assess } from "../../src/assess.ts";
import { parseUnifiedDiff } from "../../src/diff.ts";
import {
  findRemovedGuard,
  missingRequiredSignals,
  newCodeLines,
} from "../../src/executors/common.ts";
import { loadRegistry, validateExecutorShape, validateTruthRepositories } from "../../src/registry.ts";
import { checkConclusion, renderMarkdown } from "../../src/report.ts";
import { compilePattern, lineMatches, normalizeLine, stripComments, stripCommentsFromLine } from "../../src/text.ts";
import type { Registry, Truth, Workspace } from "../../src/types.ts";

const registry = loadRegistry("iris");
const apiRepo = "ignitetech-group/iris-api";
const enginesRepo = "ignitetech-group/iris-sp-engines";

function memoryWorkspace(files: Record<string, string>, root = "/memory"): Workspace {
  return {
    root,
    read: (relPath) => files[relPath],
    list: (patterns) =>
      Object.keys(files).filter((path) =>
        patterns.length === 0 || patterns.some((pattern) =>
          pattern === "**/*" || path.startsWith(pattern.replace(/\*+$/, "")),
        ),
      ),
  };
}

function truthFixture(overrides: Partial<Truth>): Truth {
  return {
    id: "TEST-TRUTH-0001",
    tenant: "iris",
    title: "A test truth for validation",
    statement: "Something must remain true for testing purposes.",
    status: "live",
    executor: { kind: "pattern", blocking: true },
    applies_to: { repositories: ["ignitetech-group/iris-api"] },
    evidence: [{ type: "jira", key: "TEST-1" }],
    governance: { owner: "care-compatibility-maintainers", version: 1 },
    ...overrides,
  } as Truth;
}

function withRegistry(truths: Truth[]): Registry {
  return { tenant: registry.tenant, truths, surfaces: [], coupling: [] };
}

describe("comments are not behaviour", () => {
  it("strips line and block comments but never string literals", () => {
    const source = [
      "// JSON.stringify(parsedBody) is wrong here",
      "/* also JSON.stringify(parsedBody) */",
      "const message = 'components not started';",
      "const url = \"http://example.com//not-a-comment\";",
    ].join("\n");
    const stripped = stripComments(source, "webhook.component.ts");
    assert.doesNotMatch(stripped, /JSON\.stringify/);
    // A signal that legitimately lives inside a string literal — like the
    // DEGRADED_AUTH log message IRIS-TRUTH-0013 matches on — must survive.
    assert.match(stripped, /components not started/);
    assert.match(stripped, /example\.com\/\/not-a-comment/);
  });

  it("preserves line count so per-line matching stays aligned", () => {
    const source = "const a = 1;\n/* two\nline\ncomment */\nconst b = 2;";
    assert.equal(stripComments(source, "a.ts").split("\n").length, source.split("\n").length);
  });

  it("leaves unknown file types alone rather than guessing", () => {
    const source = "-- a SQL-looking comment\nSELECT 1;";
    assert.equal(stripComments(source, "notes.unknown"), source);
  });

  it("does not lose the rest of a line to a regex literal containing slashes", () => {
    // `/https:\/\//` ends in two literal slashes. Reading those as the start of
    // a line comment discarded everything after them, silently dropping any
    // token a truth needed to match later on that line.
    const source = String.raw`const re = /https:\/\//; const q = "use_meta LIKE '%x%'";`;
    const stripped = stripComments(source, "a.ts");
    assert.match(stripped, /LIKE '%x%'/);
    assert.equal(stripped, source);
  });

  it("still strips a real comment that follows a regex literal", () => {
    assert.equal(
      stripComments(String.raw`const re = /ab/; // strip me`, "a.ts").trimEnd(),
      "const re = /ab/;",
    );
  });

  it("treats a lone slash as division, not the start of a regex", () => {
    assert.equal(stripComments("const r = a / b / c;", "a.ts"), "const r = a / b / c;");
    assert.equal(
      stripComments("const r = total / count; // note", "a.ts").trimEnd(),
      "const r = total / count;",
    );
  });

  it("keeps a regex literal that follows an arrow function", () => {
    // Excluding `>` from regex-start positions to fix `</div>` also excluded
    // `=>`, so `.filter(u => /\/\//.test(u))` truncated at the regex's own `//`
    // and lost the rest of the line.
    for (const source of [
      String.raw`const f = (u: string) => /^\/\//.test(u) && verifySignature(u);`,
      String.raw`const hits = urls.filter((u) => /\/\//.test(u)); verifySignature(raw);`,
    ]) {
      assert.match(stripComments(source, "a.ts"), /verifySignature/, source);
    }
  });

  it("does not mistake a JSX closing tag for the start of a regex", () => {
    // `</div>` is `<` followed by `/`. Treating `<` as a position where a regex
    // may start made the scanner consume the rest of the line hunting for a
    // closing slash, so any comment after a closing tag survived — reopening
    // the comment-ghost bypass in exactly the .tsx files that matter.
    for (const source of [
      "      </div> // onGenerateCampaign was removed",
      "      </div>{/* <GenerateCampaignPanel onGenerateCampaign={h} /> */}",
      "      </span></div> // ghost onGenerateCampaign",
    ]) {
      assert.doesNotMatch(
        stripComments(source, "PublisherCalendarPage.tsx"),
        /onGenerateCampaign/,
        `comment survived stripping: ${source}`,
      );
    }
    // Real code after a closing tag must still survive.
    assert.match(
      stripComments("      </div>); return onGenerateCampaign;", "a.tsx"),
      /return onGenerateCampaign/,
    );
  });

  it("only blanks a leading `*` where it cannot be code", () => {
    // JSDoc continuation and terminator in TypeScript: comments.
    assert.equal(stripCommentsFromLine("   * bytes JSON.stringify(parsedBody)", "a.ts"), "");
    assert.equal(stripCommentsFromLine("  */", "a.ts"), "");
    // Pointer dereference in C, Rust and Go: real code that must survive.
    assert.equal(stripCommentsFromLine("  *ptr = 1;", "a.c"), "  *ptr = 1;");
    assert.equal(stripCommentsFromLine("  *ptr = 1;", "a.rs"), "  *ptr = 1;");
    assert.equal(stripCommentsFromLine("  *p = 1;", "a.go"), "  *p = 1;");
    // Generator methods in TypeScript also begin with `*`.
    assert.match(
      stripCommentsFromLine("  *gen() { return verifySignature(raw); }", "a.ts"),
      /verifySignature/,
    );
    assert.match(
      stripCommentsFromLine("  *[Symbol.iterator]() { yield secret; }", "a.ts"),
      /Symbol\.iterator/,
    );
  });

  it("does not treat a comment-only addition as new code", () => {
    const file = parseUnifiedDiff([
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,3 @@",
      " const a = 1;",
      "+// LIKE '%bad%' must never be added",
      "+const b = 2;",
    ].join("\n")).files[0]!;
    assert.deepEqual(newCodeLines(file).map((line) => line.trim()), ["const b = 2;"]);
  });
});

describe("a reformatted violation is not a new violation", () => {
  const diff = [
    "diff --git a/src/repositories/admin/users.repository.ts b/src/repositories/admin/users.repository.ts",
    "--- a/src/repositories/admin/users.repository.ts",
    "+++ b/src/repositories/admin/users.repository.ts",
    "@@ -80,3 +80,3 @@",
    "     if (activeOnly) {",
    "-      query += ` AND u.use_meta LIKE '%\"isApiUser\":true%'`;",
    "+        query += ` AND u.use_meta LIKE '%\"isApiUser\":true%'`;",
    "     }",
  ].join("\n");

  it("passes IRIS-TRUTH-0019 when an existing wildcard line is only reindented", () => {
    // iris-api holds 78 pre-existing leading-wildcard LIKEs across 11 files.
    // A modified line arrives as both removed and added, so without this the
    // truth fired on every reformat of an already-non-compliant query.
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff(diff),
      source: "reindent",
      registry,
      workspace: memoryWorkspace({}),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0019");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });

  it("still fails when a change increases the number of violating lines", () => {
    const worse = [
      "diff --git a/src/repositories/admin/users.repository.ts b/src/repositories/admin/users.repository.ts",
      "--- a/src/repositories/admin/users.repository.ts",
      "+++ b/src/repositories/admin/users.repository.ts",
      "@@ -80,3 +80,4 @@",
      "     if (activeOnly) {",
      "-      query += ` AND u.use_meta LIKE '%\"isApiUser\":true%'`;",
      "+      query += ` AND u.use_meta LIKE '%\"isApiUser\":true%'`;",
      "+      query += ` AND u.his_metadata LIKE '%\"reason\":\"X\"%'`;",
      "     }",
    ].join("\n");
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff(worse),
      source: "one-more-wildcard",
      registry,
      workspace: memoryWorkspace({}),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0019");
    assert.equal(finding?.verdict, "fail", JSON.stringify(result.findings, null, 2));
    assert.equal(finding?.failureClass, "introduced");
  });

  it("normalises whitespace and comments when comparing lines", () => {
    assert.equal(
      normalizeLine("  const a = 1;   // trailing note", "a.ts"),
      normalizeLine("const a = 1;", "a.ts"),
    );
  });

  it("pairs added against removed one-for-one, not by set membership", () => {
    // Copying an already-violating query to a second call site adds two
    // identical lines and removes one. Asking only "was this line also
    // removed?" answered yes for both copies and missed the new violation
    // entirely — a false negative on the most ordinary way to spread one.
    const bad = "    return db.query(\"SELECT id FROM t WHERE use_meta LIKE '%\" + q + \"%'\");";
    const build = (added: string[], removed: string[]) => parseUnifiedDiff([
      "diff --git a/src/repositories/admin/search.repository.ts b/src/repositories/admin/search.repository.ts",
      "--- a/src/repositories/admin/search.repository.ts",
      "+++ b/src/repositories/admin/search.repository.ts",
      "@@ -1,8 +1,10 @@",
      " export class SearchRepo {",
      ...removed.map((line) => `-${line}`),
      ...added.map((line) => `+${line}`),
      " }",
    ].join("\n"));

    const verdictFor = (added: string[], removed: string[]) => assess({
      repo: apiRepo,
      diff: build(added, removed),
      source: "pairing",
      registry,
      workspace: memoryWorkspace({}),
    }).findings.find((item) => item.truthId === "IRIS-TRUTH-0019")?.verdict;

    // Net new violations must be reported however many copies there are.
    assert.equal(verdictFor([bad, bad], [bad]), "fail");
    assert.equal(verdictFor([bad, bad, bad], [bad]), "fail");
    // A copy that differs only by an appended comment is still a copy.
    assert.equal(verdictFor([bad, `${bad} // second call site`], [bad]), "fail");
    // One-for-one pairing still absorbs a pure reindent and a pure deletion.
    assert.equal(verdictFor([`  ${bad}`], [bad]), "pass");
    assert.equal(verdictFor([], [bad]), "pass");
  });
});

describe("a diff line is read in the context of its file", () => {
  it("does not report an addition that is entirely inside a block comment", () => {
    // Stripping each diff line on its own cannot see that a line sits inside a
    // `/* ... */`, so every line of a commented-out query read as new code.
    const file = "export const a = 1;\n/*\nconst sql = `SELECT id FROM t WHERE use_meta LIKE '%v%'`;\n*/\n";
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/repositories/admin/notes.repository.ts b/src/repositories/admin/notes.repository.ts",
        "--- a/src/repositories/admin/notes.repository.ts",
        "+++ b/src/repositories/admin/notes.repository.ts",
        "@@ -1,1 +1,4 @@",
        " export const a = 1;",
        "+/*",
        "+const sql = `SELECT id FROM t WHERE use_meta LIKE '%v%'`;",
        "+*/",
      ].join("\n")),
      source: "commented-out",
      registry,
      workspace: memoryWorkspace({ "src/repositories/admin/notes.repository.ts": file }),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0019");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });

  it("still reports the same query when it is real code", () => {
    const file = "export const a = 1;\nconst sql = `SELECT id FROM t WHERE use_meta LIKE '%v%'`;\n";
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/repositories/admin/notes.repository.ts b/src/repositories/admin/notes.repository.ts",
        "--- a/src/repositories/admin/notes.repository.ts",
        "+++ b/src/repositories/admin/notes.repository.ts",
        "@@ -1,1 +1,2 @@",
        " export const a = 1;",
        "+const sql = `SELECT id FROM t WHERE use_meta LIKE '%v%'`;",
      ].join("\n")),
      source: "real-code",
      registry,
      workspace: memoryWorkspace({ "src/repositories/admin/notes.repository.ts": file }),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0019");
    assert.equal(finding?.verdict, "fail", JSON.stringify(result.findings, null, 2));
  });
});

describe("revision provenance is always stated", () => {
  it("marks an assessment unverified when nothing tied the diff to the checkout", () => {
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -0,0 +1 @@",
        "+export const a = 1;",
      ].join("\n")),
      source: "no-provenance",
      registry,
      workspace: memoryWorkspace({}),
    });
    assert.equal(result.revision.verified, false);
    assert.match(result.revision.note ?? "", /unverified/);
    assert.equal(result.baselineAvailable, false);
    assert.match(renderMarkdown(result), /UNVERIFIED/);
  });

  it("reports that a baseline was available when one is supplied", () => {
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -0,0 +1 @@",
        "+export const a = 1;",
      ].join("\n")),
      source: "with-baseline",
      registry,
      workspace: memoryWorkspace({}),
      baseWorkspace: memoryWorkspace({}),
      revision: { verified: true, workspaceSha: "a".repeat(40) },
    });
    assert.equal(result.baselineAvailable, true);
    assert.match(renderMarkdown(result), /Baseline:\*\* available/);
  });
});

describe("a truth regex cannot hang a run", () => {
  it("skips lines too long to be authored code", () => {
    // A bounded-gap pattern retried from every anchor match on a 100KB
    // generated line took over an hour: two benchmark cases went from ~2s to
    // 4970s and 2259s. Substring checks stay unbounded; only regex is capped.
    const pattern = "\\b(?:use_meta)\\b[^\\n]{0,200}?LIKE\\s+['\"]%";
    const monster = "use_meta ".repeat(12_000);
    const started = process.hrtime.bigint();
    assert.equal(lineMatches(pattern, monster), false);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(elapsedMs < 250, `took ${elapsedMs}ms`);
  });

  it("still matches a real violating line", () => {
    const pattern = "\\b(?:use_meta)\\b[^\\n]{0,200}?LIKE\\s+['\"]%";
    assert.equal(
      lineMatches(pattern, `      query += \` AND u.use_meta LIKE '%"isApiUser":true%'\`;`),
      true,
    );
  });

  it("keeps every shipped pattern bounded between its anchors", () => {
    // An unbounded `[^\n]*` gap is what caused the hang. New patterns must not
    // reintroduce one.
    for (const truth of registry.truths) {
      for (const pattern of truth.executor.forbidden_line_patterns ?? []) {
        assert.doesNotMatch(
          pattern,
          /\[\^\\n\]\*/,
          `${truth.id} has an unbounded [^\\n]* gap; use a bounded {0,N} instead`,
        );
      }
    }
  });
});

describe("a whole-checkout ratchet does not narrow to the changed files", () => {
  // Short-circuiting the workspace listing on the change's own files made a
  // `mode: workspace` truth inspect only that pull request's files as soon as it
  // touched anything in scope. The ratchet was loudest on changes that touched
  // nothing relevant and silent on changes to the directory it guards.
  const files: Record<string, string> = {
    "src/dirty.ts": "const legacyGate = 'SOCIALGATEWAY_FORBIDDEN';",
    "src/clean.ts": "export const ok = 1;",
    "docs/x.md": "# notes",
  };
  const ratchet = withRegistry([
    truthFixture({
      id: "TEST-TRUTH-0005",
      executor: {
        kind: "pattern",
        blocking: true,
        mode: "workspace",
        forbidden_signals: ["SOCIALGATEWAY_FORBIDDEN"],
      },
      applies_to: { repositories: [apiRepo], paths: ["src/**"], scan_workspace: true },
    }),
  ]);

  const verdictWhenTouching = (path: string, base?: Record<string, string>) => assess({
    repo: apiRepo,
    diff: parseUnifiedDiff([
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1,1 +1,2 @@",
      " x",
      "+  // touched",
    ].join("\n")),
    source: "ratchet",
    registry: ratchet,
    workspace: memoryWorkspace(files),
    ...(base ? { baseWorkspace: memoryWorkspace(base) } : {}),
  }).findings.find((item) => item.truthId === "TEST-TRUTH-0005");

  for (const path of ["docs/x.md", "src/clean.ts", "src/dirty.ts"]) {
    it(`reports the standing violation when the change touches ${path}`, () => {
      const finding = verdictWhenTouching(path);
      assert.equal(finding?.verdict, "fail", `expected the ratchet to fire for ${path}`);
      assert.equal(finding?.evidence.path, "src/dirty.ts");
    });
  }

  it("attributes by comparing base with head, not by which file was touched", () => {
    // Touching the file a standing leftover lives in does not make the leftover
    // yours. Only the base state can settle that.
    const alreadyDirty = files;
    assert.equal(verdictWhenTouching("src/dirty.ts", alreadyDirty)?.failureClass, "preexisting");
    assert.equal(verdictWhenTouching("src/clean.ts", alreadyDirty)?.failureClass, "preexisting");

    // Clean at base, dirty at head: this change did introduce it.
    const cleanBase = { ...files, "src/dirty.ts": "const fine = 1;" };
    assert.equal(verdictWhenTouching("src/dirty.ts", cleanBase)?.failureClass, "introduced");
  });

  it("refuses to attribute at all when no base state is available", () => {
    const finding = verdictWhenTouching("src/dirty.ts");
    assert.equal(finding?.verdict, "fail");
    assert.equal(finding?.failureClass, "unknown");
  });
});

describe("comment markers in hash and shell syntax", () => {
  it("does not treat a non-comment # as a comment", () => {
    // `$#`, `${p#pre}` and `url=...#frag` all lost the rest of their line.
    assert.match(
      stripComments("if [ $# -eq 0 ]; then verify_signature; fi", "run.sh"),
      /verify_signature/,
    );
    assert.match(
      stripComments('name=${path#prefix}; verify_signature "$name"', "run.sh"),
      /verify_signature/,
    );
    assert.match(stripComments("url=https://x/y#frag", "app.properties"), /#frag/);
  });

  it("does not let an apostrophe hide a # comment", () => {
    // A lone apostrophe in prose is not a string literal. Treating it as one
    // swallowed the `#`, leaving a commented-out token readable as code — which
    // would have satisfied IRIS-TRUTH-0003's must_contain_any on a promotion
    // workflow whose e2e selection was actually commented out.
    assert.doesNotMatch(
      stripComments("      - name: don't run this  # publisherCoverage disabled", "qa001-deploy.yaml"),
      /publisherCoverage/,
    );
    // A quoted marker is still content.
    assert.match(
      stripComments('test_grep: "P14 # not a comment"', "qa001-deploy.yaml"),
      /P14 # not a comment/,
    );
  });
});

describe("an advisory failure is not reported as truths holding", () => {
  it("labels a failing non-blocking truth honestly and still does not gate", () => {
    // `blocking: false` means "must not fail the check", not "may be described
    // as holding". The finding rendered under its own heading while the
    // headline said SELECTED TRUTHS HOLD and the check went green.
    const advisory = withRegistry([
      truthFixture({
        id: "TEST-TRUTH-0004",
        applies_to: { repositories: [apiRepo], paths: ["src/**"] },
        executor: {
          kind: "pattern",
          blocking: false,
          mode: "added_lines",
          forbidden_signals: ["execSync("],
        },
      }),
    ]);
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,1 +1,2 @@",
        " const x = 1;",
        "+execSync(cmd);",
      ].join("\n")),
      source: "advisory",
      registry: advisory,
      workspace: memoryWorkspace({}),
    });
    assert.equal(result.outcome, "advisory_fact_failed");
    assert.equal(result.truthCoverage.passed, 0);
    const markdown = renderMarkdown(result);
    assert.doesNotMatch(markdown, /SELECTED TRUTHS HOLD/);
    assert.match(markdown, /ADVISORY FACT FAILED/);
    // Advisory means advisory: never a failing check, even under `error`.
    assert.equal(
      checkConclusion(result.verdict, "error", result.coverage.status, result.outcome),
      "neutral",
    );
  });
});

describe("removed-guard detection is scoped to one file", () => {
  const tokens = ["getWebhookSecretCandidates"];

  it("does not let a token in another changed file mask a removal", () => {
    const diff = parseUnifiedDiff([
      "diff --git a/engines/facebook/src/webhook/webhook.component.ts b/engines/facebook/src/webhook/webhook.component.ts",
      "--- a/engines/facebook/src/webhook/webhook.component.ts",
      "+++ b/engines/facebook/src/webhook/webhook.component.ts",
      "@@ -1,2 +1,1 @@",
      "-const secrets = getWebhookSecretCandidates(page);",
      "+const secrets = [CONFIG.FACEBOOK_APP_SECRET];",
      "diff --git a/engines/facebook/src/webhook/other.ts b/engines/facebook/src/webhook/other.ts",
      "--- a/engines/facebook/src/webhook/other.ts",
      "+++ b/engines/facebook/src/webhook/other.ts",
      "@@ -1,1 +1,2 @@",
      " export const x = 1;",
      "+// getWebhookSecretCandidates lives elsewhere now",
    ].join("\n"));
    const evidence = findRemovedGuard(diff.files, tokens);
    assert.ok(evidence, "the removal must still be reported");
    assert.equal(evidence?.path, "engines/facebook/src/webhook/webhook.component.ts");
  });

  it("does not report a removal when the guard survives elsewhere in the same file", () => {
    const diff = parseUnifiedDiff([
      "diff --git a/engines/facebook/src/webhook/webhook.component.ts b/engines/facebook/src/webhook/webhook.component.ts",
      "--- a/engines/facebook/src/webhook/webhook.component.ts",
      "+++ b/engines/facebook/src/webhook/webhook.component.ts",
      "@@ -10,2 +10,1 @@",
      "-  const dead = getWebhookSecretCandidates(page);",
      "+  // consolidated below",
    ].join("\n"));
    // The hunk shows the token disappearing, but the file still calls it out of
    // view. Judging from hunk context alone reported that as a lost guard.
    const workspace = memoryWorkspace({
      "engines/facebook/src/webhook/webhook.component.ts":
        "function verify() {\n  return getWebhookSecretCandidates(page);\n}\n",
    });
    assert.equal(findRemovedGuard(diff.files, tokens, workspace), undefined);
  });

  it("ignores a guard token that only ever appeared in a removed comment", () => {
    const diff = parseUnifiedDiff([
      "diff --git a/engines/facebook/src/webhook/webhook.component.ts b/engines/facebook/src/webhook/webhook.component.ts",
      "--- a/engines/facebook/src/webhook/webhook.component.ts",
      "+++ b/engines/facebook/src/webhook/webhook.component.ts",
      "@@ -1,2 +1,1 @@",
      "-// see getWebhookSecretCandidates for the rotation story",
      " export const x = 1;",
    ].join("\n"));
    assert.equal(findRemovedGuard(diff.files, tokens, memoryWorkspace({})), undefined);
  });
});

describe("required guards must hold together", () => {
  it("does not accept guard A in one file and guard B in another", () => {
    // Joining every scoped file into one haystack satisfied a rule whose whole
    // point is that both guards appear at the same decision site.
    const evidence = missingRequiredSignals(
      [
        { path: "a.ts", body: "if (!board) return drop();" },
        { path: "b.ts", body: "const includeHidden = options.includeHidden;" },
      ],
      ["includeHidden", "drop("],
    );
    assert.ok(evidence, "split guards must not satisfy the rule");
  });

  it("accepts both guards in the same file", () => {
    assert.equal(
      missingRequiredSignals(
        [{ path: "a.ts", body: "const includeHidden = o.includeHidden;\nif (!board) return drop();" }],
        ["includeHidden", "drop("],
      ),
      undefined,
    );
  });

  it("ignores guards that appear only in comments", () => {
    assert.ok(missingRequiredSignals(
      [{ path: "a.ts", body: "// includeHidden and drop( are handled upstream\nconst x = 1;" }],
      ["includeHidden", "drop("],
    ));
  });
});

describe("coverage reflects inspection, not selection", () => {
  it("does not mark an untouched area covered because an always_on truth was selected", () => {
    // A one-line comment change to an unrelated reporting util reported
    // "coverage: full", because every always_on truth was counted as inspecting
    // every file. That fed a green check for a file nothing opened.
    const diff = parseUnifiedDiff([
      "diff --git a/src/features/reporting/utils/formatDate.ts b/src/features/reporting/utils/formatDate.ts",
      "--- a/src/features/reporting/utils/formatDate.ts",
      "+++ b/src/features/reporting/utils/formatDate.ts",
      "@@ -1,2 +1,3 @@",
      " export function formatDate(d: Date): string {",
      "+  // clarify UTC handling",
      "   return d.toISOString();",
    ].join("\n"));
    const result = assess({
      repo: "ignitetech-group/iris-web",
      diff,
      source: "unrelated",
      registry,
      workspace: memoryWorkspace({
        "src/features/publishing/calendar/components/PublisherCalendarHeader.tsx":
          "<button onClick={() => onGenerateCampaign?.()}>\n  Generate Campaign\n</button>",
        "src/features/publishing/calendar/PublisherCalendarPage.tsx":
          "import { GenerateCampaignPanel } from './x';\n<PublisherCalendarHeader onGenerateCampaign={h} />\n<GenerateCampaignPanel />",
        ".github/workflows/qa001-deploy.yaml": "test_grep: \"P14|Generate Campaign\"",
      }),
    });
    assert.deepEqual(result.coverage.coveredFiles, []);
    assert.deepEqual(result.coverage.uncoveredFiles, ["src/features/reporting/utils/formatDate.ts"]);
    assert.equal(result.coverage.status, "none");
  });
});

describe("a delegated truth is not a verified pass", () => {
  it("reports inconclusive when every selected truth was delegated", () => {
    const coderabbitOnly = withRegistry([
      truthFixture({
        id: "TEST-TRUTH-0002",
        applies_to: { repositories: [apiRepo], paths: ["src/**"] },
        executor: {
          kind: "coderabbit",
          blocking: false,
          coderabbit_path: "src/**",
          coderabbit_instruction: "Look at this by hand.",
        },
      }),
    ]);
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -0,0 +1 @@",
        "+export const a = 1;",
      ].join("\n")),
      source: "delegated-only",
      registry: coderabbitOnly,
      workspace: memoryWorkspace({}),
    });
    assert.equal(result.outcome, "only_delegated");
    assert.equal(result.verdict, "inconclusive");
    assert.equal(result.truthCoverage.passed, 0);
    assert.equal(result.truthCoverage.delegated, 1);
  });
});

describe("recorded exceptions are honoured and reported", () => {
  const diff = parseUnifiedDiff([
    "diff --git a/src/services/legacy.ts b/src/services/legacy.ts",
    "--- a/src/services/legacy.ts",
    "+++ b/src/services/legacy.ts",
    "@@ -0,0 +1 @@",
    "+const provider = 'applebc';",
  ].join("\n"));

  const base = truthFixture({
    id: "TEST-TRUTH-0003",
    applies_to: { repositories: [apiRepo], paths: ["src/**"] },
    executor: {
      kind: "pattern",
      blocking: true,
      mode: "added_lines",
      forbidden_signals: ["provider = 'applebc'"],
    },
  });

  it("waives a violation covered by an unexpired exception", () => {
    const result = assess({
      repo: apiRepo,
      diff,
      source: "waived",
      registry: withRegistry([{
        ...base,
        exceptions: [{
          path: "src/services/legacy.ts",
          reason: "Documented legacy-parity decision recorded on the ticket.",
          approved_by: "care-compatibility-maintainers",
          expires: "2030-01-01",
        }],
      }]),
      workspace: memoryWorkspace({}),
      now: new Date("2026-09-01"),
    });
    assert.equal(result.findings.length, 0);
    assert.equal(result.waived.length, 1);
    assert.equal(result.waived[0]?.approvedBy, "care-compatibility-maintainers");
    assert.equal(result.truthCoverage.waived, 1);
  });

  it("stops waiving once the exception expires", () => {
    const result = assess({
      repo: apiRepo,
      diff,
      source: "expired",
      registry: withRegistry([{
        ...base,
        exceptions: [{
          path: "src/services/legacy.ts",
          reason: "Documented legacy-parity decision recorded on the ticket.",
          approved_by: "care-compatibility-maintainers",
          expires: "2026-01-01",
        }],
      }]),
      workspace: memoryWorkspace({}),
      now: new Date("2026-09-01"),
    });
    assert.equal(result.waived.length, 0);
    assert.equal(result.verdict, "fail");
  });
});

describe("failures are attributed to whoever caused them", () => {
  it("calls a leftover in an untouched file pre-existing", () => {
    const result = assess({
      repo: apiRepo,
      diff: parseUnifiedDiff([
        "diff --git a/src/services/unrelated.ts b/src/services/unrelated.ts",
        "--- a/src/services/unrelated.ts",
        "+++ b/src/services/unrelated.ts",
        "@@ -0,0 +1 @@",
        "+logger.info('hello');",
      ].join("\n")),
      source: "untouched-leftover",
      registry,
      workspace: memoryWorkspace({
        "src/services/smm/content-sources.service.ts":
          "throw new Error('SOCIALGATEWAY_FACEBOOK_APP_ID is required for Marketing Facebook credentials');",
      }),
      baseWorkspace: memoryWorkspace({
        "src/services/smm/content-sources.service.ts":
          "throw new Error('SOCIALGATEWAY_FACEBOOK_APP_ID is required for Marketing Facebook credentials');",
      }),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0009");
    assert.equal(finding?.verdict, "fail");
    assert.equal(finding?.failureClass, "preexisting");
    // The overall verdict still fails, but the outcome distinguishes the cause so
    // the author is not told they broke it.
    assert.equal(result.outcome, "preexisting_fact_failed");
  });
});

describe("registry validation rejects unenforceable configuration", () => {
  it("rejects a truth scoped to an undeclared repository", () => {
    assert.throws(
      () => validateTruthRepositories(
        truthFixture({ applies_to: { repositories: ["acme/not-ours"] } }),
        registry.tenant.repositories,
      ),
      /tenant\.yaml does not list/,
    );
  });

  it("rejects a live truth declaring emit: semgrep with nothing to compile", () => {
    assert.throws(
      () => validateExecutorShape(truthFixture({
        executor: { kind: "contract", blocking: true, emit: "semgrep", query_anchor: "t", query_required: "d" },
      })),
      /no forbidden_signals or/,
    );
  });

  it("rejects a product truth that names files but asserts nothing", () => {
    assert.throws(
      () => validateExecutorShape(truthFixture({
        executor: { kind: "product", blocking: true, files: ["a.ts"] },
      })),
      /asserts nothing/,
    );
  });

  it("rejects a live pattern, contract or semgrep truth that asserts nothing", () => {
    // Such a truth loads cleanly, passes on every change, and counts toward
    // coverage — the invented pass this validation exists to prevent.
    for (const kind of ["pattern", "contract", "semgrep"] as const) {
      assert.throws(
        () => validateExecutorShape(truthFixture({ executor: { kind, blocking: true } })),
        /asserts nothing/,
        `${kind} with no assertions should be rejected`,
      );
    }
  });

  it("rejects kind: semgrep that cannot compile to a rule", () => {
    // Only `emit: semgrep` was checked, so `kind: semgrep` slipped through.
    assert.throws(
      () => validateExecutorShape(truthFixture({
        executor: { kind: "semgrep", blocking: true, required_signals: ["x"] },
      })),
      /no forbidden_signals or/,
    );
  });

  it("rejects require_present without required_signals", () => {
    assert.throws(
      () => validateExecutorShape(truthFixture({
        executor: { kind: "pattern", blocking: true, require_present: true },
      })),
      /require_present without required_signals/,
    );
  });

  it("allows a gap to be unfinished", () => {
    // A gap records that a check is missing. Forcing it to be fully specified
    // would mean inventing the very check whose absence it documents.
    validateExecutorShape(truthFixture({
      status: "gap",
      executor: { kind: "product", blocking: false },
    }));
  });

  it("rejects patterns that risk catastrophic backtracking", () => {
    // The first guard only caught a quantifier immediately before the closing
    // paren, so the three worse shapes below passed — `(a*|b)+` takes nine
    // seconds on a 28-character input.
    for (const pattern of ["(a+)+b", "^(a|a)*$", "^(a{1,}){2,}$", "^(a*|b)+$"]) {
      assert.throws(
        () => compilePattern(pattern, "test"),
        /catastrophic backtracking/,
        `${pattern} should be rejected`,
      );
    }
  });

  it("still accepts the patterns the shipped registry uses", () => {
    // The guard must not reject legitimate alternation that is not quantified.
    for (const truth of registry.truths) {
      for (const pattern of [
        ...(truth.executor.forbidden_line_patterns ?? []),
        ...(truth.executor.leftover_patterns ?? []),
        ...(truth.executor.must_contain_patterns ?? []),
      ]) {
        compilePattern(pattern, truth.id);
      }
    }
  });

  it("rejects an over-long pattern", () => {
    assert.throws(() => compilePattern("a".repeat(501), "test"), /exceeds 500/);
  });
});

describe("the shipped registry stays internally consistent", () => {
  it("has no live truth whose signals are all prose", () => {
    // Every historical detection in the benchmark came from a real code token.
    // Prose like `fail open` or `skip persistState` can only match a fixture
    // written to contain it, so it reports coverage that does not exist.
    const prose = [
      "fail open", "fail closed", "skip persistState", "in-memory only dedup",
      "engine-wide auth failure", "treat missing board as visible",
      "assume visible when absent", "verify against CONFIG only",
      "ignore page appSecret", "skip getMessagingUserProfile",
      "skip doc_src_id", "uuid as message id", "Date.now() as dedup",
    ];
    for (const truth of registry.truths.filter((item) => item.status === "live")) {
      const signals = [
        ...(truth.executor.forbidden_signals ?? []),
        ...(truth.executor.required_signals ?? []),
        ...(truth.executor.leftover_tokens ?? []),
      ];
      for (const signal of signals) {
        assert.ok(
          !prose.includes(signal),
          `${truth.id} still carries the prose signal \`${signal}\``,
        );
      }
    }
  });

  it("keeps every live truth's paths non-empty so selection is scoped", () => {
    for (const truth of registry.truths.filter((item) => item.status === "live")) {
      assert.ok(
        (truth.applies_to.paths?.length ?? 0) > 0,
        `${truth.id} has no paths and would select on every change`,
      );
    }
  });

  it("does not ship a live truth that reads the checkout without saying so", () => {
    // Truths that read the checkout can report a failure the current author did
    // not cause. That is legitimate for a ratchet, but it must be a deliberate
    // choice, so the full set is pinned here. Adding one should be a visible
    // decision, not a side effect of editing a mode field.
    const ratchets = registry.truths
      .filter((truth) => truth.status === "live")
      .filter((truth) => truth.executor.kind !== "coderabbit")
      .filter((truth) =>
        truth.executor.kind === "product" ||
        truth.executor.kind === "decision" ||
        (truth.executor.mode ?? "both") !== "added_lines",
      )
      .map((truth) => truth.id)
      .sort();
    assert.deepEqual(ratchets, [
      "IRIS-TRUTH-0001", // product: reads the header source
      "IRIS-TRUTH-0002", // product: reads the calendar page
      "IRIS-TRUTH-0003", // product: reads the promotion workflow
      "IRIS-TRUTH-0004", // product: reads the e2e spec
      "IRIS-TRUTH-0006", // contract: mode both, scans the provisioner paths
      "IRIS-TRUTH-0009", // decision: the SocialGateway leftover ratchet
      "IRIS-TRUTH-0012", // pattern: require_present on the board-visibility guards
    ]);
  });
});

describe("engine-repo truths still behave after the signal rewrite", () => {
  it("keeps IRIS-TRUTH-0010 from firing on retry jitter", () => {
    // Math.random() was forbidden across every Facebook and Instagram webhook
    // and polling path. It is the ordinary way to jitter a backoff.
    const result = assess({
      repo: enginesRepo,
      diff: parseUnifiedDiff([
        "diff --git a/engines/facebook/src/polling/polling.component.ts b/engines/facebook/src/polling/polling.component.ts",
        "--- a/engines/facebook/src/polling/polling.component.ts",
        "+++ b/engines/facebook/src/polling/polling.component.ts",
        "@@ -0,0 +1,2 @@",
        "+const jitter = Math.random() * 1000;",
        "+await sleep(backoffMs + jitter);",
      ].join("\n")),
      source: "jitter",
      registry,
      workspace: memoryWorkspace({}),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0010");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });

  it("keeps IRIS-TRUTH-0011 from firing on the comment that warns about the anti-pattern", () => {
    const result = assess({
      repo: enginesRepo,
      diff: parseUnifiedDiff([
        "diff --git a/engines/instagram/src/webhook/webhook.component.ts b/engines/instagram/src/webhook/webhook.component.ts",
        "--- a/engines/instagram/src/webhook/webhook.component.ts",
        "+++ b/engines/instagram/src/webhook/webhook.component.ts",
        "@@ -0,0 +1,2 @@",
        "+   * bytes — JSON.stringify(parsedBody) reconstructs a different byte sequence",
        "+   * so the HMAC must be computed over the raw payload.",
      ].join("\n")),
      source: "comment-warning",
      registry,
      workspace: memoryWorkspace({}),
    });
    const finding = result.findings.find((item) => item.truthId === "IRIS-TRUTH-0011");
    assert.equal(finding?.verdict, "pass", JSON.stringify(result.findings, null, 2));
  });
});
