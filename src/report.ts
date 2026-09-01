import type { Assessment, CoverageStatus, Verdict } from "./types.ts";

export type EnforcementMode = "warning" | "error";

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "SELECTED TRUTHS HOLD",
  fail: "FACT FAILED",
  inconclusive: "NO SELECTED TRUTH",
};

export function renderMarkdown(assessment: Assessment): string {
  const lines: string[] = [
    "<!-- truth-compiler -->",
    "<!-- iris-regression-memory -->",
    "# Truth Compiler",
    "",
    `**Verdict:** ${VERDICT_LABEL[assessment.verdict]}`,
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
    `(${assessment.coverage.coveredFiles.length}/${assessment.coverage.reviewableFiles.length} reviewable files)`,
  );
  lines.push(
    `**Truth coverage:** ${assessment.truthCoverage.failed} failed / ${assessment.truthCoverage.passed} passed / ${assessment.truthCoverage.live} live for this repo`,
  );
  lines.push("");

  if (assessment.truthCoverage.gaps.length > 0) {
    lines.push("## Visible gaps");
    lines.push("");
    lines.push("These facts are in the registry but not yet live. They are unfinished coverage, not out of scope.");
    lines.push("");
    for (const gap of assessment.truthCoverage.gaps) {
      lines.push(`- \`${gap.truthId}\` (${gap.status}, ${gap.executor}): ${gap.title}`);
    }
    lines.push("");
  }

  if (assessment.coverage.uncoveredFiles.length > 0) {
    lines.push("## Uncovered files");
    lines.push("");
    lines.push("These files were not covered by a live truth. A non-failing result does not assert that they are safe.");
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

  if (assessment.verdict === "inconclusive") {
    lines.push("No live truth was selected for this change. This is not a safety assertion.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("## Findings");
  lines.push("");

  for (const finding of assessment.findings) {
    lines.push(`### ${finding.truthId} — ${finding.verdict.toUpperCase()} (${finding.executor}${finding.blocking ? ", blocking" : ""})`);
    lines.push(`**${finding.title}**`);
    lines.push("");
    lines.push(finding.statement.trim());
    lines.push("");
    lines.push(finding.reason);
    lines.push("");
    lines.push(`- Evidence: ${finding.evidence.detail}${finding.evidence.path ? ` (\`${finding.evidence.path}\`)` : ""}`);
    lines.push(`- Matched because: ${finding.matchReasons.join(", ")}`);
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

  lines.push("_The compiler does not LLM-judge a diff. Failures are fact id + evidence. Pattern facts are also emitted to Semgrep; review intent is emitted to CodeRabbit._");
  lines.push("");
  return lines.join("\n");
}

export function checkConclusion(
  verdict: Verdict,
  enforcement: EnforcementMode = "error",
  coverage: CoverageStatus = "full",
): "success" | "neutral" | "failure" {
  if (verdict === "fail") return enforcement === "error" ? "failure" : "neutral";
  if (verdict === "pass") return coverage === "full" ? "success" : "neutral";
  return "neutral";
}
