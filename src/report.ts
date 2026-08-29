import type { Assessment, Verdict } from "./types.ts";

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "PASS",
  fail: "FAIL",
  inconclusive: "INCONCLUSIVE",
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
  lines.push(`**Retrieved:** ${assessment.retrieved.join(", ") || "none"}`);
  lines.push("");

  if (assessment.verdict === "inconclusive") {
    lines.push("No path or interface anchor matched an approved contract. This is not a fail.");
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

  lines.push("_Semantic similarity alone cannot fail. Failures require a violation signal in added lines or a removed guard._");
  lines.push("");
  return lines.join("\n");
}

export function checkConclusion(verdict: Verdict): "success" | "neutral" | "failure" {
  if (verdict === "fail") return "failure";
  if (verdict === "pass") return "success";
  return "neutral";
}
