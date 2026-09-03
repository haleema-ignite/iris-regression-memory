import type { Assessment, AssessmentOutcome, CoverageStatus, Finding, Verdict } from "./types.ts";

export type EnforcementMode = "warning" | "error";

const OUTCOME_LABEL: Record<AssessmentOutcome, string> = {
  fact_failed: "FACT FAILED — introduced by this change",
  preexisting_fact_failed: "PRE-EXISTING FACT FAILING — not introduced by this change",
  advisory_fact_failed: "ADVISORY FACT FAILED — non-blocking, does not gate",
  unattributed_fact_failed: "FACT FAILED, ATTRIBUTION UNKNOWN — no base state to compare against",
  not_evaluated: "NOT EVALUATED — a truth could not be run; this is not a fact failure",
  selected_truths_hold: "SELECTED TRUTHS HOLD",
  only_delegated: "NOTHING VERIFIED — every selected truth was delegated",
  no_selected_truth: "NO SELECTED TRUTH",
};

function renderFinding(finding: Finding, lines: string[]): void {
  const label = finding.verdict.toUpperCase();
  lines.push(`### ${finding.truthId} — ${label} (${finding.executor}${finding.blocking ? ", blocking" : ""})`);
  lines.push(`**${finding.title}**`);
  lines.push("");
  lines.push(finding.statement.trim());
  lines.push("");
  lines.push(finding.reason);
  lines.push("");
  lines.push(`- Evidence: ${finding.evidence.detail}${finding.evidence.path ? ` (\`${finding.evidence.path}\`)` : ""}`);
  if (finding.evidence.scope && finding.evidence.scope !== "none") {
    lines.push(`- Evidence scope: ${finding.evidence.scope === "added_lines" ? "lines this change added" : "existing checkout"}`);
  }
  lines.push(`- Matched because: ${finding.matchReasons.join(", ")}`);
  if (finding.proves) {
    lines.push(`- Proves only: ${finding.proves}`);
  }
  if (finding.emit !== "none") {
    lines.push(`- Also emitted to: ${finding.emit}`);
  }
  if (finding.requiredGuards[0]) {
    lines.push(`- Required guard: ${finding.requiredGuards[0]}`);
  }
  const refs = finding.references
    .map((ref) => ref.key ?? ref.url ?? ref.note)
    .filter(Boolean)
    .join(", ");
  if (refs) {
    lines.push(`- Evidence refs: ${refs}`);
  }
  lines.push("");
}

export function renderMarkdown(assessment: Assessment): string {
  const lines: string[] = [
    "<!-- truth-compiler -->",
    "<!-- iris-regression-memory -->",
    "# Truth Compiler",
    "",
    `**Verdict:** ${OUTCOME_LABEL[assessment.outcome]}`,
    `**Tenant:** ${assessment.tenant}`,
    `**Repo:** ${assessment.repo}`,
  ];

  if (assessment.pr) {
    lines.push(`**PR:** ${assessment.pr}`);
  }
  if (assessment.sha) {
    lines.push(`**SHA:** \`${assessment.sha}\``);
  }
  lines.push(`**Source:** ${assessment.source}`);
  lines.push(`**Truths loaded:** ${assessment.truthsLoaded}`);
  lines.push(`**Truths evaluated:** ${assessment.truthsEvaluated}`);
  lines.push(`**Selected:** ${assessment.selected.join(", ") || "none"}`);
  lines.push(
    `**File coverage:** ${assessment.coverage.status} ` +
    `(${assessment.coverage.coveredFiles.length}/${assessment.coverage.reviewableFiles.length} reviewable files in scope of a live truth)`,
  );
  const tc = assessment.truthCoverage;
  lines.push(
    `**Truth coverage:** ${tc.introducedFailures} introduced / ${tc.preexistingFailures} pre-existing / ` +
    `${tc.unattributedFailures} unattributed / ${tc.passed} hold in checkout / ` +
    `${tc.noReintroduction} not reintroduced / ${tc.delegated} delegated / ` +
    `${tc.errored} not evaluated / ${tc.waived} waived / ${tc.live} live for this repo`,
  );
  lines.push(
    `**Revision:** ${assessment.revision.verified
      ? `verified (workspace \`${(assessment.revision.workspaceSha ?? "").slice(0, 12)}\`)`
      : `UNVERIFIED — ${assessment.revision.note ?? "the diff and the checkout may describe different states"}`}`,
  );
  lines.push(
    `**Baseline:** ${assessment.baselineAvailable
      ? "available, so failures are attributed by comparing base with head"
      : "NOT available, so workspace failures cannot be attributed to this change"}`,
  );
  lines.push("");

  const introduced = assessment.findings.filter(
    (finding) => finding.verdict === "fail" && finding.failureClass === "introduced",
  );
  const preexisting = assessment.findings.filter(
    (finding) => finding.verdict === "fail" && finding.failureClass === "preexisting",
  );
  const unattributed = assessment.findings.filter(
    (finding) => finding.verdict === "fail" && finding.failureClass === "unknown",
  );
  const held = assessment.findings.filter(
    (finding) => finding.verdict === "pass" && finding.proofScope === "workspace_fact_holds",
  );
  const notReintroduced = assessment.findings.filter(
    (finding) => finding.verdict === "pass" && finding.proofScope === "no_reintroduction_detected",
  );
  const delegatedFindings = assessment.findings.filter((finding) => finding.verdict === "delegated");
  const erroredFindings = assessment.findings.filter((finding) => finding.verdict === "error");

  const gaps = tc.gaps.filter((gap) => gap.status === "gap");
  const proposals = tc.gaps.filter((gap) => gap.status === "proposed");

  if (gaps.length > 0) {
    lines.push("## Visible gaps");
    lines.push("");
    lines.push(
      "Facts we know about and cannot yet prove. Unfinished coverage, not out of " +
      "scope: a clean result above does not speak to these.",
    );
    lines.push("");
    for (const gap of gaps) {
      lines.push(`- \`${gap.truthId}\` (${gap.executor}): ${gap.title}`);
    }
    lines.push("");
  }

  if (assessment.coverage.uncoveredFiles.length > 0) {
    lines.push("## Uncovered files");
    lines.push("");
    lines.push(
      "No live truth is scoped to these files. A non-failing result does not assert " +
      "that they are safe. Scope is not the same as inspection: a truth scoped to a " +
      "file may still only read part of it.",
    );
    lines.push("");
    for (const path of assessment.coverage.uncoveredFiles.slice(0, 20)) {
      lines.push(`- \`${path}\``);
    }
    if (assessment.coverage.uncoveredFiles.length > 20) {
      lines.push(`- ...and ${assessment.coverage.uncoveredFiles.length - 20} more`);
    }
    lines.push("");
  }

  if (assessment.coverage.unavailableFiles.length > 0) {
    lines.push("## Unavailable patches");
    lines.push("");
    lines.push("GitHub did not provide line patches for these files. Pattern checks did not adjudicate them.");
    lines.push("");
    for (const path of assessment.coverage.unavailableFiles.slice(0, 20)) {
      lines.push(`- \`${path}\``);
    }
    lines.push("");
  }

  if (introduced.length > 0) {
    lines.push("## Introduced by this change");
    lines.push("");
    lines.push("These failures are attributable to this pull request.");
    lines.push("");
    for (const finding of introduced) renderFinding(finding, lines);
  }

  if (preexisting.length > 0) {
    lines.push("## Pre-existing in this checkout");
    lines.push("");
    lines.push(
      "These truths are failing against the repository as it already stands. They are not " +
      "this change's regressions and would be reported for any pull request that selected them. " +
      "They need an owner and a ticket, not a fix in this branch.",
    );
    lines.push("");
    for (const finding of preexisting) renderFinding(finding, lines);
  }

  if (unattributed.length > 0) {
    lines.push("## Failing, attribution unknown");
    lines.push("");
    lines.push(
      "These truths fail against the checkout, but no base state was available to " +
      "compare against, so whether this change caused them is unknown. Re-run with " +
      "`--base-ref` to settle it. Never gating.",
    );
    lines.push("");
    for (const finding of unattributed) renderFinding(finding, lines);
  }

  if (assessment.waived.length > 0) {
    lines.push("## Waived by recorded exception");
    lines.push("");
    for (const waived of assessment.waived) {
      lines.push(
        `- \`${waived.truthId}\` at \`${waived.path}\` — ${waived.reason} ` +
        `(approved by ${waived.approvedBy}${waived.expires ? `, expires ${waived.expires}` : ""})`,
      );
    }
    lines.push("");
  }

  if (erroredFindings.length > 0) {
    lines.push("## Could not be evaluated");
    lines.push("");
    lines.push(
      "These truths could not run. That is a configuration or environment problem, " +
      "not a regression, and proves nothing in either direction.",
    );
    lines.push("");
    for (const finding of erroredFindings) {
      lines.push(`- \`${finding.truthId}\`: ${finding.reason}`);
    }
    lines.push("");
  }

  if (delegatedFindings.length > 0) {
    lines.push("## Delegated to CodeRabbit");
    lines.push("");
    lines.push("The compiler verified nothing here. These are not passes.");
    lines.push("");
    for (const finding of delegatedFindings) {
      lines.push(`- \`${finding.truthId}\`: ${finding.evidence.detail}`);
    }
    lines.push("");
  }

  if (held.length > 0) {
    lines.push("## Holds in this checkout");
    lines.push("");
    lines.push("Read against the checkout and found true there.");
    lines.push("");
    for (const finding of held) {
      lines.push(
        `- \`${finding.truthId}\` (${finding.executor}): ${finding.title}` +
        `${finding.proves ? ` — proves only: ${finding.proves}` : ""}`,
      );
    }
    lines.push("");
  }

  if (notReintroduced.length > 0) {
    lines.push("## Not reintroduced by this change");
    lines.push("");
    lines.push(
      "These truths inspected only the lines this change added. They establish that " +
      "the recorded bad pattern was not introduced here. They do **not** establish " +
      "that the fact holds in the checkout — the guard may be absent for other reasons.",
    );
    lines.push("");
    for (const finding of notReintroduced) {
      lines.push(
        `- \`${finding.truthId}\` (${finding.executor}): ${finding.title}` +
        `${finding.proves ? ` — proves only: ${finding.proves}` : ""}`,
      );
    }
    lines.push("");
  }

  if (assessment.outcome === "no_selected_truth") {
    lines.push("No live truth was selected for this change. This is not a safety assertion.");
    lines.push("");
  }

  if (proposals.length > 0) {
    lines.push("## Registry health (not about this change)");
    lines.push("");
    lines.push(
      "Observations awaiting an owner's decision before they could be encoded. " +
      "They are listed here rather than above because nothing in this change " +
      "caused them and no action is expected from this author.",
    );
    lines.push("");
    for (const proposal of proposals) {
      lines.push(`- \`${proposal.truthId}\`: ${proposal.title}`);
    }
    lines.push("");
  }

  lines.push("_The compiler does not LLM-judge a diff. Failures are fact id + evidence. Pattern facts are also emitted to Semgrep; review intent is emitted to CodeRabbit._");
  lines.push("");
  return lines.join("\n");
}

/**
 * A pull request is only failed for what it introduced. A pre-existing ratchet
 * is surfaced as neutral: it is real and must be reported, but failing the
 * author's check for a leftover they did not create is what trains a team to
 * ignore the check.
 */
export function checkConclusion(
  verdict: Verdict,
  enforcement: EnforcementMode = "warning",
  coverage: CoverageStatus = "full",
  outcome: AssessmentOutcome = "selected_truths_hold",
): "success" | "neutral" | "failure" {
  if (verdict === "fail") {
    // A pre-existing ratchet is not this author's defect, and an advisory truth
    // is explicitly non-gating. Both are reported, neither fails the check.
    if (
      outcome === "preexisting_fact_failed" ||
      outcome === "advisory_fact_failed" ||
      // Without a base state we cannot say this change caused it, so we must
      // not charge it to this author.
      outcome === "unattributed_fact_failed"
    ) {
      return "neutral";
    }
    return enforcement === "error" ? "failure" : "neutral";
  }
  if (verdict === "pass") return coverage === "full" ? "success" : "neutral";
  return "neutral";
}
