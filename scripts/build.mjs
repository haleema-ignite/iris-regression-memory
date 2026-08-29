import { chmod, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const shared = {
  bundle: true,
  format: "cjs",
  minify: true,
  platform: "node",
  target: "node20",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/cli.ts"],
    outfile: "dist/cli.cjs",
    banner: { js: "#!/usr/bin/env node" },
  }),
  build({
    ...shared,
    entryPoints: ["src/action.ts"],
    outfile: "dist/action.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/mcp.ts"],
    outfile: "dist/mcp.cjs",
    banner: { js: "#!/usr/bin/env node" },
  }),
]);

const bundles = ["dist/action.cjs", "dist/cli.cjs", "dist/mcp.cjs"];
await Promise.all(bundles.map(async (path) => {
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace(/[\t ]+$/gm, ""), "utf8");
}));

await Promise.all([chmod("dist/cli.cjs", 0o755), chmod("dist/mcp.cjs", 0o755)]);
