import { findingsFromHits } from "./adjudicate.ts";
import { retrieve } from "./retrieve.ts";
import type { AssessInput, Assessment, Verdict } from "./types.ts";

export function assess(input: AssessInput): Assessment {
  const hits = retrieve(input.contracts, input.repo, input.diff);
  const findings = findingsFromHits(hits, input.diff);

  let verdict: Verdict = "inconclusive";
  if (findings.some((finding) => finding.verdict === "fail")) {
    verdict = "fail";
  } else if (findings.length > 0) {
    verdict = "pass";
  }

  return {
    verdict,
    repo: input.repo,
    sha: input.sha,
    pr: input.pr,
    source: input.source,
    findings,
    retrieved: hits.map((hit) => hit.contract.id),
    contractsLoaded: input.contracts.length,
  };
}
