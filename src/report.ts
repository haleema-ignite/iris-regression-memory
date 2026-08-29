import type { Assessment, CoverageStatus, Verdict } from "./types.ts";

export type EnforcementMode = "warning" | "error";

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "NO KNOWN REGRESSION",
  fail: "HISTORICAL REGRESSION DETECTED",
  inconclusive: "NO APPLICABLE CONTRACT",
};

export function renderMarkdown(assessment: Assessment): string {
  const lines: string[] = [
    "<!-- iris-regression-memory -->",
    "# IRIS Behavioral Regression",
    "",
    `**Verdict:** ${VERDICT_LABEL[assessment.verdict]}`,
    `**Repo:** ${assessment.repo}`,
  ];

  if (assessment.pr) {
    lines.push(`**PR:** ${assessment.pr}`);
  }
  if (assessment.sha) {
    lines.push(`**SHA:** \`${assessment.sha}\``);
  }
  lines.push(`**Source:** ${assessment.source}`);
  lines.push(`**Contracts loaded:** ${assessment.contractsLoaded}`);
  lines.push(`**Contracts evaluated:** ${assessment.contractsEvaluated}`);
  lines.push(`**Retrieved:** ${assessment.retrieved.join(", ") || "none"}`);
  lines.push(
    `**Coverage:** ${assessment.coverage.status} ` +
    `(${assessment.coverage.coveredFiles.length}/${assessment.coverage.reviewableFiles.length} reviewable files)`,
  );
  lines.push("");

  if (assessment.coverage.uncoveredFiles.length > 0) {
    lines.push("## Uncovered files");
    lines.push("");
    lines.push(
      "These files were not covered by any contract. A non-failing result does not assert that they are behaviorally safe.",
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
    lines.push("GitHub did not provide line patches for these files. They were not adjudicated and count as uncovered.");
    lines.push("");
    for (const path of assessment.coverage.unavailableFiles.slice(0, 20)) {
      lines.push(`- \`${path}\``);
    }
    lines.push("");
  }

  if (assessment.verdict === "inconclusive") {
    lines.push("No changed file with an available patch matched an approved contract. This is not a safety assertion and does not block in warning mode.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("## Findings");
  lines.push("");

  for (const finding of assessment.findings) {
    lines.push(`### ${finding.contractId} — ${finding.verdict.toUpperCase()}`);
    lines.push(`**${finding.title}**`);
    lines.push("");
    lines.push(finding.reason);
    lines.push("");
    lines.push(`- Evidence: ${finding.evidence.detail}${finding.evidence.path ? ` (\`${finding.evidence.path}\`)` : ""}`);
    lines.push(`- Required guard: ${finding.requiredGuards[0] ?? "(none listed)"}`);
    const refs = finding.references
      .map((ref) => ref.key ?? ref.url)
      .filter(Boolean)
      .join(", ");
    if (refs) {
      lines.push(`- Incident: ${refs}`);
    }
    lines.push("");
  }

  lines.push("_Semantic similarity alone cannot fail. Failures require an explicit violation signal in added lines or an explicit historical guard signal removed from a path-matched file._");
  lines.push("");
  return lines.join("\n");
}

export function checkConclusion(
  verdict: Verdict,
  enforcement: EnforcementMode = "warning",
  coverage: CoverageStatus = "full",
): "success" | "neutral" | "failure" {
  if (verdict === "fail") return enforcement === "error" ? "failure" : "neutral";
  if (verdict === "pass") return coverage === "full" ? "success" : "neutral";
  return "neutral";
}
