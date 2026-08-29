import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { parse as parseYaml } from "yaml";
import type { BehavioralContract } from "./types.ts";

const Ajv = Ajv2020 as unknown as new (options?: object) => {
  compile<T>(schema: object): ((data: unknown) => data is T) & {
    errors?: ErrorObject[] | null;
  };
};

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");
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
    contracts.push(parsed);
  }
  return contracts;
}
