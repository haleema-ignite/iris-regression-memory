import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { assess } from "./assess.ts";
import { compileRegistry } from "./compile.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { runAssessment } from "./cli.ts";
import { assertKnownRepository, loadRegistry } from "./registry.ts";
import { repoMatches } from "./glob.ts";
import { renderMarkdown } from "./report.ts";
import { createFsWorkspace } from "./workspace.ts";

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function createTruthCompilerServer(): McpServer {
  const server = new McpServer({
    name: "truth-compiler",
    version: "1.0.0",
  });

  server.registerTool(
    "assess_diff",
    {
      title: "Assess a unified diff",
      description:
        "Assess a unified diff against live truths. Deterministic. LLM is not the merge gate. " +
        "Requires a checkout: product, decision and workspace-mode truths are proved against it.",
      inputSchema: z.object({
        repository: z.string().min(3),
        unifiedDiff: z.string().min(1),
        tenant: z.string().min(2).optional(),
        // Required, matching the CLI. A file reconstructed from hunk context is
        // not the file, so a product surface cannot be proved from a diff.
        workspace: z.string().min(1),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ repository, unifiedDiff, tenant, workspace }) => {
      const registry = loadRegistry(tenant ?? "iris");
      assertKnownRepository(registry, repository);
      const assessment = assess({
        repo: repository,
        diff: parseUnifiedDiff(unifiedDiff),
        source: "mcp:unified-diff",
        registry,
        workspace: createFsWorkspace(workspace),
      });
      return toolResult({ assessment, markdown: renderMarkdown(assessment) });
    },
  );

  server.registerTool(
    "assess_checkout",
    {
      title: "Assess a local git checkout",
      description: "Assess the working tree of a local IRIS service against live truths. Does not call GitHub. LLM is not the merge gate.",
      inputSchema: z.object({
        repository: z.string().min(3),
        workspace: z.string().min(1),
        tenant: z.string().min(2).optional(),
        base: z.string().optional(),
        head: z.string().optional(),
        noDiff: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ repository, workspace, tenant, base, head, noDiff }) => {
      const assessment = await runAssessment({
        tenant: tenant ?? "iris",
        repo: repository,
        workspace,
        base,
        head,
        noDiff,
      });
      return toolResult({ assessment, markdown: renderMarkdown(assessment) });
    },
  );

  server.registerTool(
    "assess_pull_request",
    {
      title: "Assess a GitHub pull request",
      description: "Fetch and assess a GitHub pull request using GITHUB_TOKEN or an authenticated gh CLI.",
      inputSchema: z.object({
        repository: z.string().min(3),
        pullRequest: z.number().int().positive(),
        sourceRepository: z.string().min(3).optional(),
        tenant: z.string().min(2).optional(),
        workspace: z.string().min(1),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ repository, pullRequest, sourceRepository, tenant, workspace }) => {
      const assessment = await runAssessment({
        tenant: tenant ?? "iris",
        repo: repository,
        sourceRepo: sourceRepository,
        pr: pullRequest,
        workspace,
      });
      return toolResult({ assessment, markdown: renderMarkdown(assessment) });
    },
  );

  server.registerTool(
    "list_truths",
    {
      title: "List truths",
      description: "List truths for a tenant, optionally filtered by repository.",
      inputSchema: z.object({
        tenant: z.string().min(2).optional(),
        repository: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ tenant, repository }) => {
      const registry = loadRegistry(tenant ?? "iris");
      const truths = registry.truths.filter((truth) =>
        !repository || repoMatches(truth.applies_to.repositories, repository),
      );
      return toolResult({ tenant: registry.tenant, truths });
    },
  );

  server.registerTool(
    "get_truth",
    {
      title: "Get a truth",
      description: "Return one truth by ID.",
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z][A-Z0-9]+-TRUTH-[0-9]{4}$/),
        tenant: z.string().min(2).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, tenant }) => {
      const truth = loadRegistry(tenant ?? "iris").truths.find((item) => item.id === id);
      return truth
        ? toolResult(truth)
        : { content: [{ type: "text" as const, text: `Truth ${id} was not found.` }], isError: true };
    },
  );

  server.registerTool(
    "compile_emitters",
    {
      title: "Compile Semgrep and CodeRabbit emitters",
      description: "Return generated Semgrep rules and CodeRabbit path instructions for a tenant. Does not write files.",
      inputSchema: z.object({ tenant: z.string().min(2).optional() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ tenant }) => {
      return toolResult(compileRegistry(loadRegistry(tenant ?? "iris")));
    },
  );

  return server;
}

/** @deprecated Use createTruthCompilerServer */
export const createRegressionMemoryServer = createTruthCompilerServer;

const invoked = process.argv[1]?.includes("mcp.ts") ||
  process.argv[1]?.endsWith("/mcp.mjs") ||
  process.argv[1]?.endsWith("/mcp.cjs");
if (invoked) {
  void serveStdio(createTruthCompilerServer);
}
