export type ContractStatus =
  | "extracted"
  | "reviewed"
  | "approved"
  | "active"
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
    exclusions?: string[];
    confidence: "high" | "medium" | "low";
  };
  required_guards: string[];
  governance: {
    owner: string;
    approved_by?: string;
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
  allLines: string[];
}

export interface ParsedDiff {
  files: DiffFile[];
  raw: string;
}

export type Verdict = "pass" | "fail" | "inconclusive";

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
  repo: string;
  sha?: string;
  pr?: number;
  source: string;
  findings: Finding[];
  retrieved: string[];
  contractsLoaded: number;
}

export interface AssessInput {
  repo: string;
  diff: ParsedDiff;
  sha?: string;
  pr?: number;
  source: string;
  contracts: BehavioralContract[];
}
