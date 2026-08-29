import type { Assessment } from "./types.ts";

export function renderSarif(assessment: Assessment): object {
  const failed = assessment.findings.filter((finding) => finding.verdict === "fail");
  const rules = failed.map((finding) => ({
    id: finding.contractId,
    name: finding.contractId,
    shortDescription: { text: finding.title },
    fullDescription: { text: finding.reason },
    helpUri: finding.references.find((reference) => reference.url)?.url,
    properties: {
      tags: ["behavioral-regression", "incident-memory"],
      precision: "high",
    },
  }));

  const results = failed.map((finding) => ({
    ruleId: finding.contractId,
    level: "warning",
    message: {
      text: `${finding.reason} Evidence: ${finding.evidence.detail}`,
    },
    ...(finding.evidence.path
      ? {
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: finding.evidence.path },
            },
          }],
        }
      : {}),
    properties: {
      assessmentOutcome: assessment.outcome,
      coverage: assessment.coverage.status,
    },
  }));

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: {
        driver: {
          name: "iris-regression-memory",
          semanticVersion: "0.2.0",
          rules,
        },
      },
      automationDetails: { id: assessment.source },
      results,
      properties: {
        repository: assessment.repo,
        coverage: assessment.coverage,
      },
    }],
  };
}
