import type { Assessment } from "./types.ts";

export function renderSarif(assessment: Assessment): object {
  const failed = assessment.findings.filter((finding) => finding.verdict === "fail");
  const rules = failed.map((finding) => ({
    id: finding.truthId,
    name: finding.truthId,
    shortDescription: { text: finding.title },
    fullDescription: { text: finding.reason },
    helpUri: finding.references.find((reference) => reference.url)?.url,
    properties: {
      tags: ["truth-compiler", finding.executor],
      precision: "high",
    },
  }));

  const results = failed.map((finding) => ({
    ruleId: finding.truthId,
    // A pre-existing leftover is real but is not this change's defect, so it
    // must not annotate the diff at error level.
    level: finding.failureClass === "preexisting"
      ? "note"
      : finding.blocking ? "error" : "warning",
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
      executor: finding.executor,
      failureClass: finding.failureClass,
      evidenceScope: finding.evidence.scope,
    },
  }));

  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: {
        driver: {
          name: "truth-compiler",
          semanticVersion: "1.0.0",
          rules,
        },
      },
      automationDetails: { id: assessment.source },
      results,
      properties: {
        tenant: assessment.tenant,
        repository: assessment.repo,
        coverage: assessment.coverage,
        truthCoverage: assessment.truthCoverage,
      },
    }],
  };
}
