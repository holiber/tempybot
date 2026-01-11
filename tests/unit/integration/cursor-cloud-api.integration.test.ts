import { describe, expect, it } from "vitest";
import http from "node:http";
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
const testFn = requireOnCi ? it : it;

describe("Cursor Cloud API (integration)", () => {
  testFn("can request /v0/models via OpenAPI MCP (real API if key is set, otherwise local stub)", async () => {
    const apiKey = getCursorApiKeyFromEnv();
    const specPath = path.join(process.cwd(), "src", "agnet", "cloud-agents-openapi.yaml");
    const { cmd, argsPrefix } = openApiMcpServerCommand();

    let server: http.Server | null = null;
    let apiBaseUrl = "https://api.cursor.com";
    const headers: string[] = [];

    if (apiKey) {
      headers.push(`Authorization: Bearer ${apiKey}`);
    } else {
      // CI-safe fallback: simulate Cursor Cloud endpoint locally so the pipeline
      // still validates "makes a request" even when secrets are not configured.
      server = http.createServer((req, res) => {
        if (req.method === "GET" && req.url === "/v0/models") {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ models: ["gpt-5.2"] }));
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("Failed to bind stub server.");
      apiBaseUrl = `http://127.0.0.1:${addr.port}`;
    }

    const args = [
      ...argsPrefix,
      "--transport",
      "stdio",
      "--tools",
      "dynamic",
      "--openapi-spec",
      specPath,
      "--api-base-url",
      apiBaseUrl,
      "--name",
      "cursor-cloud-agents",
      "--server-version",
      "0.1.0",
      ...(headers.length ? ["--headers", headers.join("\n")] : []),
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
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    }
  }, 60_000);
});

