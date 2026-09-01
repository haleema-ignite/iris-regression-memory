import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function discoverCompilerRoot(): string {
  const entryPoint = process.argv[1] ? dirname(dirname(resolve(process.argv[1]))) : undefined;
  const candidates = [
    process.env.TRUTH_COMPILER_ROOT,
    process.env.IRIS_REGRESSION_MEMORY_ROOT,
    process.env.GITHUB_ACTION_PATH,
    entryPoint,
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const root = candidates.find((candidate) =>
    existsSync(join(candidate, "tenants", "schema", "truth.json")),
  );
  if (!root) {
    throw new Error(
      "Could not locate tenants/schema/truth.json. Set TRUTH_COMPILER_ROOT to the package directory.",
    );
  }
  return root;
}

export const COMPILER_ROOT = discoverCompilerRoot();
export const TENANTS_DIR = join(COMPILER_ROOT, "tenants");

export function listTenantIds(): string[] {
  return readdirSync(TENANTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "schema")
    .map((entry) => entry.name)
    .sort();
}

export function readJson(path: string): object {
  return JSON.parse(readFileSync(path, "utf8")) as object;
}
