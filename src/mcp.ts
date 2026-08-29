import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { assess } from "./assess.ts";
import { loadContracts } from "./contracts.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { runAssessment } from "./cli.ts";
import { pathMatches, repoMatches } from "./retrieve.ts";
import { renderMarkdown } from "./report.ts";

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function createRegressionMemoryServer(): McpServer {
  const server = new McpServer({
    name: "iris-regression-memory",
    version: "0.2.1",
  });

  server.registerTool(
    "assess_diff",
    {
      title: "Assess a unified diff",
      description: "Assess a unified diff against approved behavioral contracts. Read-only and deterministic.",
      inputSchema: z.object({
        repository: z.string().min(3),
        unifiedDiff: z.string().min(1),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ repository, unifiedDiff }) => {
      const assessment = assess({
        repo: repository,
        diff: parseUnifiedDiff(unifiedDiff),
        source: "mcp:unified-diff",
        contracts: loadContracts(),
      });
      return toolResult({ assessment, markdown: renderMarkdown(assessment) });
    },
  );

  server.registerTool(
    "assess_pull_request",
    {
      title: "Assess a GitHub pull request",
      description: "Fetch and assess a GitHub pull request using GITHUB_TOKEN or an authenticated gh CLI. Read-only.",
      inputSchema: z.object({
        repository: z.string().min(3),
        pullRequest: z.number().int().positive(),
        sourceRepository: z.string().min(3).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ repository, pullRequest, sourceRepository }) => {
      const assessment = await runAssessment({
        repo: repository,
        sourceRepo: sourceRepository,
        pr: pullRequest,
      });
      return toolResult({ assessment, markdown: renderMarkdown(assessment) });
    },
  );

  server.registerTool(
    "list_contracts",
    {
      title: "List behavioral contracts",
      description: "List sanitized behavioral contracts, optionally filtered by repository and path.",
      inputSchema: z.object({
        repository: z.string().optional(),
        path: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ repository, path }) => {
      const contracts = loadContracts().filter((contract) =>
        (!repository || repoMatches(contract, repository)) &&
        (!path || pathMatches(contract, path)),
      );
      return toolResult(contracts);
    },
  );

  server.registerTool(
    "get_contract",
    {
      title: "Get a behavioral contract",
      description: "Return one sanitized behavioral contract by ID.",
      inputSchema: z.object({ id: z.string().regex(/^IRIS-BEH-[0-9]{4}$/) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => {
      const contract = loadContracts().find((item) => item.id === id);
      return contract
        ? toolResult(contract)
        : { content: [{ type: "text" as const, text: `Contract ${id} was not found.` }], isError: true };
    },
  );

  return server;
}

const invoked = process.argv[1]?.includes("mcp.ts") ||
  process.argv[1]?.endsWith("/mcp.mjs") ||
  process.argv[1]?.endsWith("/mcp.cjs");
if (invoked) {
  void serveStdio(createRegressionMemoryServer);
}
