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
    truths.push(parsed);
  }

  const ids = new Set<string>();
  for (const truth of truths) {
    if (ids.has(truth.id)) {
      throw new Error(`Duplicate truth id ${truth.id}`);
    }
    ids.add(truth.id);
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
