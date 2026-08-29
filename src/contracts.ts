import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { parse as parseYaml } from "yaml";
import type { BehavioralContract } from "./types.ts";

const Ajv = Ajv2020 as unknown as new (options?: object) => {
  compile<T>(schema: object): ((data: unknown) => data is T) & {
    errors?: ErrorObject[] | null;
  };
};

function discoverRepoRoot(): string {
  const entryPoint = process.argv[1] ? dirname(dirname(resolve(process.argv[1]))) : undefined;
  const candidates = [
    process.env.IRIS_REGRESSION_MEMORY_ROOT,
    process.env.GITHUB_ACTION_PATH,
    entryPoint,
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const root = candidates.find((candidate) => existsSync(join(candidate, "contracts", "schema.json")));
  if (!root) {
    throw new Error(
      "Could not locate contracts/schema.json. Set IRIS_REGRESSION_MEMORY_ROOT to the package directory.",
    );
  }
  return root;
}

export const REPO_ROOT = discoverRepoRoot();
export const DEFAULT_CONTRACTS_DIR = join(REPO_ROOT, "contracts", "iris");
export const SCHEMA_PATH = join(REPO_ROOT, "contracts", "schema.json");

export function loadSchema(): object {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
}

export function createValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile<BehavioralContract>(loadSchema());
}

export function loadContracts(dir = DEFAULT_CONTRACTS_DIR): BehavioralContract[] {
  const validate = createValidator();
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();

  const contracts: BehavioralContract[] = [];
  for (const name of files) {
    const fullPath = join(dir, name);
    const parsed = parseYaml(readFileSync(fullPath, "utf8"));
    if (!validate(parsed)) {
      const errors = (validate.errors ?? [])
        .map((err: ErrorObject) => `${err.instancePath || "/"} ${err.message}`)
        .join("; ");
      throw new Error(`${name} failed schema validation: ${errors}`);
    }
    for (const pattern of parsed.applicability.violation_line_patterns ?? []) {
      try {
        new RegExp(pattern, "i");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${name} has invalid violation_line_pattern \`${pattern}\`: ${message}`);
      }
    }
    contracts.push(parsed);
  }
  return contracts;
}
