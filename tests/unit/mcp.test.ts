import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTruthCompilerServer } from "../../src/mcp.ts";

/**
 * The MCP server is part of the advertised surface, so its tools should not be
 * able to disappear or be renamed silently.
 *
 * This is a construction and registration check, not a protocol round-trip:
 * nothing here speaks stdio JSON-RPC. `npm run trial:local` says so explicitly
 * rather than claiming the MCP surface was exercised.
 */
describe("MCP server", () => {
  const server = createTruthCompilerServer() as unknown as {
    _registeredTools: Record<string, unknown>;
  };
  const toolNames = Object.keys(server._registeredTools).sort();

  it("registers every advertised tool", () => {
    assert.deepEqual(toolNames, [
      "assess_checkout",
      "assess_diff",
      "assess_pull_request",
      "compile_emitters",
      "get_truth",
      "list_truths",
    ]);
  });

  it("keeps the deprecated factory alias working", async () => {
    const { createRegressionMemoryServer } = await import("../../src/mcp.ts");
    assert.equal(createRegressionMemoryServer, createTruthCompilerServer);
  });
});
