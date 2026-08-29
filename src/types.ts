export type ContractStatus =
  | "extracted"
  | "reviewed"
  | "approved"
  | "superseded"
  | "deprecated";

export interface IncidentReference {
  type: "jira" | "github" | "rca" | "confluence";
  key?: string;
  url?: string;
}

export interface BehavioralContract {
  id: string;
  title: string;
  status: ContractStatus;
  scope: {
    products?: string[];
    repositories: string[];
    services?: string[];
    paths: string[];
    symbols?: string[];
    interfaces?: {
      kafka_topics?: string[];
      configuration_keys?: string[];
    };
  };
  incident: {
    severity?: string;
    occurred_at?: string;
    culprit_pr?: string;
    fixing_pr?: string;
    references: IncidentReference[];
  };
  behavior: {
    invariant: string;
    failure_mechanism: string;
    triggers?: string[];
    consequences?: string[];
  };
  applicability: {
    strong_anchors: string[];
    violation_signals?: string[];
    removal_signals?: string[];
    excluded_paths?: string[];
    exclusion_notes?: string[];
    confidence: "high" | "medium" | "low";
  };
  required_guards: string[];
  governance: {
    owner: string;
    approved_at?: string;
    review_after?: string;
    version: number;
  };
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  patch: string;
  addedLines: string[];
  removedLines: string[];
  contextLines: string[];
  allLines: string[];
  patchAvailable: boolean;
}

export interface ParsedDiff {
  files: DiffFile[];
  raw: string;
}

export type Verdict = "pass" | "fail" | "inconclusive";

export type AssessmentOutcome =
  | "historical_regression_detected"
  | "no_known_regression"
  | "no_applicable_contract";

export type CoverageStatus = "none" | "partial" | "full";

export interface AssessmentCoverage {
  status: CoverageStatus;
  reviewableFiles: string[];
  coveredFiles: string[];
  uncoveredFiles: string[];
  unavailableFiles: string[];
}

export interface FindingEvidence {
  kind: "violation_signal" | "guard_removed" | "none";
  detail: string;
  path?: string;
}

export interface Finding {
  contractId: string;
  title: string;
  verdict: "pass" | "fail";
  reason: string;
  evidence: FindingEvidence;
  requiredGuards: string[];
  references: IncidentReference[];
  score: number;
}

export interface Assessment {
  verdict: Verdict;
  outcome: AssessmentOutcome;
  repo: string;
  sha?: string;
  pr?: number;
  source: string;
  findings: Finding[];
  retrieved: string[];
  contractsLoaded: number;
  contractsEvaluated: number;
  coverage: AssessmentCoverage;
}

export interface AssessInput {
  repo: string;
  diff: ParsedDiff;
  sha?: string;
  pr?: number;
  source: string;
  contracts: BehavioralContract[];
}
