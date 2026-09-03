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
  /** Satisfied when at least one entry is present. Use to assert a positive
   *  outcome without pinning it to one spelling of the negative. */
  must_contain_any?: string[];
  /** Regex form of must_contain, for structural assertions a substring cannot
   *  express (for example a label inside JSX rather than anywhere in the file). */
  must_contain_patterns?: string[];
  must_not_contain?: string[];
  forbidden_signals?: string[];
  forbidden_signal_groups?: string[][];
  forbidden_line_patterns?: string[];
  required_signals?: string[];
  /**
   * Guards that must hold together *within one file*, one group at a time.
   *
   * `required_signals` is a single such group, which is wrong whenever a fact
   * spans two decision sites: IRIS-TRUTH-0012's resolver lives in
   * polling.component.ts while its filtering guards live in filtering.ts, so
   * demanding all three from one file failed canonical code.
   */
  required_signal_groups?: string[][];
  leftover_tokens?: string[];
  /** Regex form of leftover_tokens, so rewording an error message does not
   *  silently convert a ratchet into a pass. */
  leftover_patterns?: string[];
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

/**
 * A recorded, owned decision that a specific known occurrence does not count as
 * a violation. Exceptions are reported, never silent: an assessment lists them
 * so a reviewer can see what was waived and why.
 */
export interface TruthException {
  path: string;
  reason: string;
  evidence?: EvidenceRef;
  approved_by: string;
  expires?: string;
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
  exceptions?: TruthException[];
  failure_mechanism?: string;
  required_guards?: string[];
  /** What this executor actually proves, when that is narrower than the
   *  statement. Rendered in the report so a pass is not over-read. */
  proves?: string;
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
  /** 1-based line numbers of `addedLines` in the file after the change. */
  addedLineNumbers: number[];
  removedLines: string[];
  /** 1-based line numbers of `removedLines` in the file before the change. */
  removedLineNumbers: number[];
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
  /** This change introduced a violation. */
  | "fact_failed"
  /** Nothing was introduced, but a standing ratchet is failing on the checkout. */
  | "preexisting_fact_failed"
  /** Only advisory (non-blocking) truths failed. Reported, never gating. */
  | "advisory_fact_failed"
  /** Failures exist but could not be attributed to this change. Never gating. */
  | "unattributed_fact_failed"
  /** A truth could not be evaluated at all. A configuration or environment
   *  problem, not a regression. Never gating. */
  | "not_evaluated"
  | "selected_truths_hold"
  /** Truths were selected but every one was delegated, so nothing was verified. */
  | "only_delegated"
  | "no_selected_truth";

export type CoverageStatus = "none" | "partial" | "full";

export interface AssessmentCoverage {
  status: CoverageStatus;
  reviewableFiles: string[];
  coveredFiles: string[];
  uncoveredFiles: string[];
  unavailableFiles: string[];
}

/**
 * Where the evidence came from. `added_lines` means this change introduced it;
 * `workspace` means it was already true of the checkout and would be reported
 * for any pull request that selected this truth.
 */
export type EvidenceScope = "added_lines" | "workspace" | "none";

export interface FindingEvidence {
  kind: EvidenceKind;
  detail: string;
  path?: string;
  scope?: EvidenceScope;
}

/**
 * `introduced` — the truth held at base and fails at head, or the evidence is a
 *   line this change added. Actionable by this author, and the only class that
 *   may fail a check.
 * `preexisting` — the truth fails at base too. Real, but not this author's
 *   regression, so it must never be reported as "you broke this".
 * `unknown` — no base state was available to compare against, so attribution
 *   could not be established. Reported, never blocking.
 */
export type FailureClass = "introduced" | "preexisting" | "unknown";

/**
 * What a non-failing result actually establishes.
 *
 * An added-lines truth can only prove that a known bad pattern was not
 * introduced by this change. It cannot prove its own statement: IRIS-TRUTH-0011
 * passes on a branch where the mixed-secret guards are absent entirely, because
 * this change did not remove them. Reporting that as "verified holding" invites
 * exactly the over-reading the registry is supposed to prevent.
 */
export type ProofScope =
  /** The executor read the checkout and the fact holds there. */
  | "workspace_fact_holds"
  /** Only the change's added lines were inspected. */
  | "no_reintroduction_detected"
  /** Handed to a contextual reviewer; nothing was verified. */
  | "delegated"
  /** Selected but not adjudicated: the executor could not run. */
  | "not_evaluated";

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
  verdict: "pass" | "fail" | "delegated" | "error";
  /** Set only when verdict is `fail`. */
  failureClass?: FailureClass;
  /** What this result establishes, which is often narrower than the statement. */
  proofScope: ProofScope;
  reason: string;
  evidence: FindingEvidence;
  matchReasons: MatchReason[];
  requiredGuards: string[];
  references: EvidenceRef[];
  /** What the executor actually proved, when narrower than the statement. */
  proves?: string;
}

/** A violation that matched a recorded, owned exception instead of failing. */
export interface WaivedFinding {
  truthId: string;
  title: string;
  path: string;
  reason: string;
  approvedBy: string;
  expires?: string;
  evidence: FindingEvidence;
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
  /** Failures this change introduced, blocking or advisory. */
  introducedFailures: number;
  /** Failures already true of the checkout before this change. */
  preexistingFailures: number;
  /** Failures that could not be attributed, for want of a base state. */
  unattributedFailures: number;
  /** Truths read against the checkout and found holding there. */
  passed: number;
  /** Truths that only established "this change did not reintroduce it". */
  noReintroduction: number;
  delegated: number;
  /** Truths whose executor could not run. Not a fact failure. */
  errored: number;
  waived: number;
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
  waived: WaivedFinding[];
  selected: string[];
  truthsLoaded: number;
  truthsEvaluated: number;
  coverage: AssessmentCoverage;
  truthCoverage: TruthCoverage;
  /** How the diff and the checkout were reconciled. */
  revision: RevisionProvenance;
  /** Whether a base state was available for attribution. */
  baselineAvailable: boolean;
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
  /**
   * The checkout as it stood before this change. Required to tell a regression
   * this change caused from a violation that was already there — without it,
   * workspace-evidence failures can only be reported as `unknown`.
   */
  baseWorkspace?: Workspace;
  /** How the diff and the checkout were confirmed to describe the same state. */
  revision?: RevisionProvenance;
  /** Injected so exception expiry is deterministic in tests. */
  now?: Date;
}

/**
 * Whether the diff and the workspace are known to describe the same revision.
 *
 * A diff that says a control was deleted, assessed against a checkout where it
 * still exists, produces a confident and wrong pass. Recording provenance means
 * a conclusion drawn from mismatched inputs is labelled as such.
 */
export interface RevisionProvenance {
  verified: boolean;
  workspaceSha?: string;
  expectedSha?: string;
  baseSha?: string;
  note?: string;
  /** Why no base state was available, when that is the case. */
  baseNote?: string;
}
