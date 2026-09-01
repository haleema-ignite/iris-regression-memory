export type TruthStatus = "live" | "proposed" | "gap" | "superseded" | "deprecated";

export type ExecutorKind =
  | "pattern"
  | "product"
  | "contract"
  | "decision"
  | "semgrep"
  | "coderabbit";

export type EmitTarget = "none" | "semgrep" | "coderabbit";

export type PatternMode = "added_lines" | "workspace" | "both";

export type EvidenceKind =
  | "violation_signal"
  | "violation_signal_group"
  | "violation_line_pattern"
  | "guard_removed"
  | "product_missing"
  | "contract_broken"
  | "stale_decision"
  | "workspace_required"
  | "delegated"
  | "none";

export interface EvidenceRef {
  type: "jira" | "github" | "rca" | "confluence" | "slack" | "e2e";
  key?: string;
  url?: string;
  note?: string;
}

export interface ExecutorSpec {
  kind: ExecutorKind;
  blocking: boolean;
  emit?: EmitTarget;
  mode?: PatternMode;
  files?: string[];
  must_contain?: string[];
  must_not_contain?: string[];
  forbidden_signals?: string[];
  forbidden_signal_groups?: string[][];
  forbidden_line_patterns?: string[];
  required_signals?: string[];
  leftover_tokens?: string[];
  allowlist_paths?: string[];
  query_anchor?: string;
  query_required?: string;
  query_allow_if?: string[];
  require_present?: boolean;
  languages?: string[];
  coderabbit_path?: string;
  coderabbit_instruction?: string;
  e2e_repository?: string;
  e2e_spec?: string;
  e2e_case?: string;
}

export interface AppliesTo {
  repositories: string[];
  paths?: string[];
  excluded_paths?: string[];
  always_on?: boolean;
  scan_workspace?: boolean;
  coupling?: string[];
}

export interface Governance {
  owner: string;
  approved_at?: string;
  review_after?: string;
  version: number;
}

export interface Truth {
  id: string;
  tenant: string;
  title: string;
  statement: string;
  status: TruthStatus;
  executor: ExecutorSpec;
  applies_to: AppliesTo;
  evidence: EvidenceRef[];
  failure_mechanism?: string;
  required_guards?: string[];
  legacy_id?: string;
  governance: Governance;
}

export interface ProductSurface {
  id: string;
  name: string;
  artifact: string;
  always_on: boolean;
  repositories: string[];
  truth_ids: string[];
}

export interface CouplingGroup {
  id: string;
  statement: string;
  paths: string[];
  markers?: string[];
  truth_ids: string[];
}

export interface Tenant {
  id: string;
  name: string;
  github_org?: string;
  repositories: string[];
  default_enforcement?: "warning" | "error";
}

export interface Registry {
  tenant: Tenant;
  truths: Truth[];
  surfaces: ProductSurface[];
  coupling: CouplingGroup[];
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
  | "fact_failed"
  | "selected_truths_hold"
  | "no_selected_truth";

export type CoverageStatus = "none" | "partial" | "full";

export interface AssessmentCoverage {
  status: CoverageStatus;
  reviewableFiles: string[];
  coveredFiles: string[];
  uncoveredFiles: string[];
  unavailableFiles: string[];
}

export interface FindingEvidence {
  kind: EvidenceKind;
  detail: string;
  path?: string;
}

export type MatchReason =
  | "path"
  | "always_on"
  | "product_catalog"
  | "stale_decision_scan"
  | `coupling:${string}`;

export interface Finding {
  truthId: string;
  title: string;
  statement: string;
  executor: ExecutorKind;
  emit: EmitTarget;
  blocking: boolean;
  verdict: "pass" | "fail";
  reason: string;
  evidence: FindingEvidence;
  matchReasons: MatchReason[];
  requiredGuards: string[];
  references: EvidenceRef[];
}

export interface GapRecord {
  truthId: string;
  title: string;
  status: TruthStatus;
  statement: string;
  executor: ExecutorKind;
}

export interface TruthCoverage {
  live: number;
  selected: number;
  failed: number;
  passed: number;
  gaps: GapRecord[];
}

export interface Assessment {
  verdict: Verdict;
  outcome: AssessmentOutcome;
  tenant: string;
  repo: string;
  sha?: string;
  pr?: number;
  source: string;
  findings: Finding[];
  selected: string[];
  truthsLoaded: number;
  truthsEvaluated: number;
  coverage: AssessmentCoverage;
  truthCoverage: TruthCoverage;
}

export interface Workspace {
  root?: string;
  read(relPath: string): string | undefined;
  list(patterns: string[]): string[];
}

export interface AssessInput {
  tenantId?: string;
  repo: string;
  diff: ParsedDiff;
  sha?: string;
  pr?: number;
  source: string;
  registry: Registry;
  workspace?: Workspace;
}
