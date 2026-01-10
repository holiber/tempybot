import { describe, expect, it } from "vitest";
import path from "node:path";

import { McpStdioClient, openApiMcpServerCommand } from "../../../src/agnet/mcp-stdio-client.js";

function parseToolTextJson(result: unknown): unknown {
  const root = result && typeof result === "object" ? (result as any) : null;
  const content = Array.isArray(root?.content) ? root.content : null;
  const text = typeof content?.[0]?.text === "string" ? content[0].text : "";
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as unknown;
}

describe("OpenAPI MCP server (integration)", () => {
  it("can retrieve endpoint schema from repo YAML spec", async () => {
    const specPath = path.join(process.cwd(), "src", "agnet", "cloud-agents-openapi.yaml");
    const { cmd, argsPrefix } = openApiMcpServerCommand();
    const args = [
      ...argsPrefix,
      "--transport",
      "stdio",
      "--tools",
      "dynamic",
      "--openapi-spec",
      specPath,
      "--api-base-url",
      "https://api.cursor.com",
      "--name",
      "cursor-cloud-agents",
      "--server-version",
      "0.1.0",
    ];

    const client = new McpStdioClient(cmd, args);
    try {
      const init = await client.request("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "tempybot-tests", version: "0.0.0" },
      });
      expect(init.error).toBeUndefined();
      client.notify("notifications/initialized", {});

      const tools = await client.request("tools/list", {});
      expect(tools.error).toBeUndefined();
      const toolNames = Array.isArray((tools.result as any)?.tools)
        ? ((tools.result as any).tools as any[]).map((t) => t?.name).filter(Boolean)
        : [];
      expect(toolNames).toContain("get-api-endpoint-schema");

      const schema = await client.request("tools/call", {
        name: "get-api-endpoint-schema",
        arguments: { endpoint: "/v0/models" },
      });
      expect(schema.error).toBeUndefined();

      const parsed = parseToolTextJson(schema.result) as any;
      expect(parsed.path).toBe("/v0/models");
      expect(Array.isArray(parsed.operations)).toBe(true);
      expect(parsed.operations.some((op: any) => op?.operationId === "listModels" && op?.method === "GET")).toBe(true);
    } finally {
      await client.close().catch(() => {});
    }
  }, 60_000);
});

