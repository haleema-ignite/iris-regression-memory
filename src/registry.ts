import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { parse as parseYaml } from "yaml";
import { COMPILER_ROOT, TENANTS_DIR, readJson } from "./paths.ts";
import { compilePattern } from "./text.ts";
import type {
  CouplingGroup,
  ProductSurface,
  Registry,
  Tenant,
  Truth,
} from "./types.ts";

const Ajv = Ajv2020 as unknown as new (options?: object) => {
  compile<T>(schema: object): ((data: unknown) => data is T) & {
    errors?: ErrorObject[] | null;
  };
};

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((err) => `${err.instancePath || "/"} ${err.message}`)
    .join("; ");
}

function loadYaml(path: string): unknown {
  return parseYaml(readFileSync(path, "utf8"));
}

/**
 * Whether this truth can produce a Semgrep rule. Semgrep rules are regexes, so
 * a truth that expresses itself any other way (a query anchor, a required file,
 * a product surface) cannot be compiled into one.
 */
export function isSemgrepEmittable(truth: Truth): boolean {
  return (truth.executor.forbidden_line_patterns?.length ?? 0) > 0 ||
    (truth.executor.forbidden_signals?.length ?? 0) > 0;
}

/**
 * Reject truth files whose executor cannot do what it claims. These used to
 * surface at run time as a `fail`, which is wrong twice over: a configuration
 * mistake is not a regression, and it would be reported against whichever pull
 * request happened to select the truth.
 */
/**
 * Reject a repository the tenant does not declare.
 *
 * An unrecognised repository selects zero truths, which an assessment would
 * otherwise report as a clean abstention rather than as the typo it is.
 */
export function assertKnownRepository(registry: Registry, repo: string): void {
  const needle = repo.trim().toLowerCase();
  if (registry.tenant.repositories.some((item) => item.trim().toLowerCase() === needle)) return;
  throw new Error(
    `\`${repo}\` is not a repository of tenant \`${registry.tenant.id}\`. ` +
    `Known repositories: ${registry.tenant.repositories.join(", ")}`,
  );
}

/**
 * A truth scoped to a repository the tenant does not declare can never be
 * selected. Loading it silently reports registry coverage that does not exist.
 */
export function validateTruthRepositories(truth: Truth, declaredRepositories: string[]): void {
  const declared = new Set(declaredRepositories.map((repo) => repo.trim().toLowerCase()));
  for (const repo of truth.applies_to.repositories) {
    const value = repo.trim().toLowerCase();
    if (value === "*" || declared.has(value)) continue;
    throw new Error(
      `${truth.id} applies to \`${repo}\`, which tenant.yaml does not list. ` +
      `Known repositories: ${declaredRepositories.join(", ")}`,
    );
  }
}

export function validateExecutorShape(truth: Truth): void {
  const { executor } = truth;
  const where = `${truth.id} (${executor.kind})`;

  // Shape requirements bind live truths only. A gap or proposal is unfinished by
  // definition and never executes; requiring it to be fully specified would
  // force authors to invent a check in order to record that one is missing.
  // Promoting it to live is where these checks must bite.
  const enforceable = truth.status === "live";

  if (enforceable && executor.kind === "product") {
    if ((executor.files?.length ?? 0) === 0) {
      throw new Error(`${where} must name executor.files.`);
    }
    const assertions = (executor.must_contain?.length ?? 0) +
      (executor.must_contain_any?.length ?? 0) +
      (executor.must_contain_patterns?.length ?? 0) +
      (executor.must_not_contain?.length ?? 0);
    if (assertions === 0) {
      throw new Error(`${where} names files but asserts nothing about them.`);
    }
  }

  // Checked before the "asserts nothing" rule below, so the more specific
  // message wins for this specific mistake.
  if (executor.require_present && (executor.required_signals?.length ?? 0) === 0) {
    throw new Error(`${where} sets require_present without required_signals.`);
  }

  // A live pattern, contract or semgrep truth with nothing to assert loads
  // cleanly, always passes, and counts toward coverage — the invented pass this
  // validation exists to prevent.
  if (enforceable && (executor.kind === "pattern" || executor.kind === "contract" || executor.kind === "semgrep")) {
    const assertions = (executor.forbidden_signals?.length ?? 0) +
      (executor.forbidden_signal_groups?.length ?? 0) +
      (executor.forbidden_line_patterns?.length ?? 0) +
      (executor.required_signals?.length ?? 0) +
      (executor.query_anchor ? 1 : 0);
    if (assertions === 0) {
      throw new Error(`${where} asserts nothing: it would pass on every change.`);
    }
  }

  if (enforceable && executor.kind === "decision") {
    if ((executor.leftover_tokens?.length ?? 0) + (executor.leftover_patterns?.length ?? 0) === 0) {
      throw new Error(`${where} must name leftover_tokens or leftover_patterns.`);
    }
  }

  if (enforceable && executor.kind === "coderabbit" && !executor.coderabbit_instruction) {
    throw new Error(`${where} must carry a coderabbit_instruction.`);
  }

  if (executor.query_anchor && !executor.query_required) {
    throw new Error(`${where} sets query_anchor without query_required.`);
  }

  // A truth that declares Semgrep emission but compiles to no rule silently
  // overstates coverage: the manifest would claim the fact is enforced there.
  // `kind: semgrep` is itself a declaration of Semgrep emission, so it must be
  // emittable too — checking only `emit === "semgrep"` let it slip through.
  if (
    truth.status === "live" &&
    (executor.emit === "semgrep" || executor.kind === "semgrep") &&
    !isSemgrepEmittable(truth)
  ) {
    throw new Error(
      `${where} declares emit: semgrep but has no forbidden_signals or ` +
      `forbidden_line_patterns to compile into a rule. Use emit: none, or give it a pattern.`,
    );
  }

  // An added-lines truth cannot prove its own statement — it can only say the
  // recorded pattern was not introduced here. Forcing an explicit `proves`
  // makes that limit visible in the report instead of leaving a reader to
  // assume the statement was verified.
  if (
    enforceable &&
    executor.kind !== "coderabbit" &&
    (executor.mode ?? "both") === "added_lines" &&
    !truth.proves
  ) {
    throw new Error(
      `${where} inspects only added lines, so it must state what it \`proves\`. ` +
      "A pass here means \"not reintroduced\", not \"the fact holds\".",
    );
  }

  for (const exception of truth.exceptions ?? []) {
    if (!exception.path.trim() || !exception.reason.trim() || !exception.approved_by.trim()) {
      throw new Error(`${where} has an exception missing path, reason, or approved_by.`);
    }
    if (exception.expires && Number.isNaN(Date.parse(exception.expires))) {
      throw new Error(`${where} has an exception with an unparseable expires \`${exception.expires}\`.`);
    }
  }
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort()
    .map((name) => join(dir, name));
}

export function loadRegistry(tenantId = "iris"): Registry {
  const tenantDir = join(TENANTS_DIR, tenantId);
  if (!existsSync(tenantDir)) {
    throw new Error(`Unknown tenant \`${tenantId}\`. Available tenants live under tenants/.`);
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateTenant = ajv.compile<Tenant>(readJson(join(COMPILER_ROOT, "tenants/schema/tenant.json")));
  const validateTruth = ajv.compile<Truth>(readJson(join(COMPILER_ROOT, "tenants/schema/truth.json")));
  const validateCatalog = ajv.compile<{ surfaces?: ProductSurface[]; groups?: CouplingGroup[] }>(
    readJson(join(COMPILER_ROOT, "tenants/schema/catalog.json")),
  );

  const tenantRaw = loadYaml(join(tenantDir, "tenant.yaml"));
  if (!validateTenant(tenantRaw)) {
    throw new Error(`tenant.yaml failed schema validation: ${formatErrors(validateTenant.errors)}`);
  }

  const truths: Truth[] = [];
  for (const file of yamlFiles(join(tenantDir, "truths"))) {
    const parsed = loadYaml(file);
    if (!validateTruth(parsed)) {
      throw new Error(`${file} failed schema validation: ${formatErrors(validateTruth.errors)}`);
    }
    if (parsed.tenant !== tenantRaw.id) {
      throw new Error(`${file} tenant \`${parsed.tenant}\` does not match tenant.yaml id \`${tenantRaw.id}\``);
    }
    for (const pattern of parsed.executor.forbidden_line_patterns ?? []) {
      compilePattern(pattern, `${parsed.id} forbidden_line_patterns`);
    }
    for (const pattern of parsed.executor.leftover_patterns ?? []) {
      compilePattern(pattern, `${parsed.id} leftover_patterns`);
    }
    for (const pattern of parsed.executor.must_contain_patterns ?? []) {
      compilePattern(pattern, `${parsed.id} must_contain_patterns`);
    }
    validateExecutorShape(parsed);
    truths.push(parsed);
  }

  const ids = new Set<string>();
  for (const truth of truths) {
    if (ids.has(truth.id)) {
      throw new Error(`Duplicate truth id ${truth.id}`);
    }
    ids.add(truth.id);
  }

  for (const truth of truths) {
    validateTruthRepositories(truth, tenantRaw.repositories);
  }

  let surfaces: ProductSurface[] = [];
  const surfacesPath = join(tenantDir, "catalog", "product-surfaces.yaml");
  if (existsSync(surfacesPath)) {
    const parsed = loadYaml(surfacesPath);
    if (!validateCatalog(parsed)) {
      throw new Error(`product-surfaces.yaml failed schema validation: ${formatErrors(validateCatalog.errors)}`);
    }
    surfaces = parsed.surfaces ?? [];
  }

  let coupling: CouplingGroup[] = [];
  const couplingPath = join(tenantDir, "catalog", "coupling.yaml");
  if (existsSync(couplingPath)) {
    const parsed = loadYaml(couplingPath);
    if (!validateCatalog(parsed)) {
      throw new Error(`coupling.yaml failed schema validation: ${formatErrors(validateCatalog.errors)}`);
    }
    coupling = parsed.groups ?? [];
  }

  const catalogIds = [
    ...surfaces.flatMap((surface) => surface.truth_ids),
    ...coupling.flatMap((group) => group.truth_ids),
  ];
  for (const id of catalogIds) {
    if (!ids.has(id)) {
      throw new Error(`Catalog references unknown truth ${id}`);
    }
  }

  return { tenant: tenantRaw, truths, surfaces, coupling };
}
