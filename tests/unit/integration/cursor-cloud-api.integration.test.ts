import { describe, expect, it } from "vitest";
import path from "node:path";

import { McpStdioClient, openApiMcpServerCommand } from "../../../src/agnet/mcp-stdio-client.js";
import { getCursorApiKeyFromEnv } from "../../../src/agnet/env.ts";

function parseToolTextJson(result: unknown): unknown {
  const root = result && typeof result === "object" ? (result as any) : null;
  const content = Array.isArray(root?.content) ? root.content : null;
  const text = typeof content?.[0]?.text === "string" ? content[0].text : "";
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as unknown;
}

const requireOnCi = Boolean(process.env.GITHUB_ACTIONS || process.env.CI);
const hasKey = Boolean(getCursorApiKeyFromEnv());
const testFn = requireOnCi ? it : hasKey ? it : it.skip;

describe("Cursor Cloud API (integration)", () => {
  testFn("can make an authenticated request to /v0/models via OpenAPI MCP", async () => {
    const apiKey = getCursorApiKeyFromEnv();
    expect(apiKey, "Missing Cursor API key env (CURSOR_CLOUD_API_KEY / CURSOR_API_KEY / CURSORCLOUDAPIKEY).").toBeTruthy();

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
      "--headers",
      `Authorization: Bearer ${apiKey}`,
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

      const call = await client.request("tools/call", {
        name: "invoke-api-endpoint",
        arguments: { endpoint: "/v0/models", method: "GET", params: {} },
      });
      expect(call.error).toBeUndefined();

      const parsed = parseToolTextJson(call.result) as any;
      expect(Array.isArray(parsed?.models), `Unexpected /v0/models response shape: ${JSON.stringify(parsed)}`).toBe(true);
      expect(parsed.models.length).toBeGreaterThan(0);
      expect(parsed.models.every((m: any) => typeof m === "string" && m.trim().length > 0)).toBe(true);
    } finally {
      await client.close().catch(() => {});
    }
  }, 60_000);
});

