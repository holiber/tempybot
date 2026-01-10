import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { executeGh } from "./cerebellum.ts";
import { McpStdioClient, openApiMcpServerCommand } from "./mcp-stdio-client.ts";

export type SelfCheckItem =
  | { name: string; ok: true; required: boolean; skipped?: false; details?: Record<string, unknown> }
  | {
      name: string;
      ok: false;
      required: boolean;
      skipped?: boolean;
      error: { message: string };
      details?: Record<string, unknown>;
    };

export type SelfCheckReport = {
  ok: boolean;
  checks: SelfCheckItem[];
};

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function isRequireCursorCli(): boolean {
  return readEnv("AGNET_SELF_CHECK_REQUIRE_CURSOR_CLI") === "1";
}

function isRequireGitHub(): boolean {
  return readEnv("AGNET_SELF_CHECK_REQUIRE_GITHUB") === "1";
}

function isRequireCursorApi(): boolean {
  return readEnv("AGNET_SELF_CHECK_REQUIRE_CURSOR_API") === "1";
}

function shouldFail(item: SelfCheckItem): boolean {
  return item.ok ? false : item.required;
}

function parseToolTextJson(result: unknown): unknown {
  const root = result && typeof result === "object" ? (result as any) : null;
  const content = Array.isArray(root?.content) ? root.content : null;
  const text = typeof content?.[0]?.text === "string" ? content[0].text : "";
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

async function checkMcpOpenApiSchema(): Promise<SelfCheckItem> {
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
      clientInfo: { name: "tempybot-selfcheck", version: "0.0.0" },
    });
    if (init.error) {
      return { name: "mcp.openapi.schema", ok: false, required: true, error: { message: init.error.message } };
    }
    client.notify("notifications/initialized", {});

    const tools = await client.request("tools/list", {});
    if (tools.error) {
      return { name: "mcp.openapi.schema", ok: false, required: true, error: { message: tools.error.message } };
    }

    const schema = await client.request("tools/call", {
      name: "get-api-endpoint-schema",
      arguments: { endpoint: "/v0/models" },
    });
    if (schema.error) {
      return { name: "mcp.openapi.schema", ok: false, required: true, error: { message: schema.error.message } };
    }

    const parsed = parseToolTextJson(schema.result);
    const ops = (parsed as any)?.operations;
    const opIds = Array.isArray(ops)
      ? ops.map((o: any) => (typeof o?.operationId === "string" ? o.operationId : "")).filter(Boolean)
      : [];

    return {
      name: "mcp.openapi.schema",
      ok: true,
      required: true,
      details: {
        hasListModels: opIds.includes("listModels"),
        operationIds: opIds,
      },
    };
  } catch (err) {
    return {
      name: "mcp.openapi.schema",
      ok: false,
      required: true,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function checkGitHubViaGh(): Promise<SelfCheckItem> {
  const require = isRequireGitHub();
  const res = await executeGh(["api", "rate_limit"]);
  if (!res.ok) {
    if (!require) {
      return {
        name: "github.gh",
        ok: false,
        required: false,
        skipped: true,
        error: { message: res.error.message },
        details: { note: "Not required (set AGNET_SELF_CHECK_REQUIRE_GITHUB=1 to require)." },
      };
    }
    return { name: "github.gh", ok: false, required: true, error: { message: res.error.message } };
  }
  return { name: "github.gh", ok: true, required: require };
}

function checkCursorCli(): SelfCheckItem {
  const require = isRequireCursorCli();
  const r = spawnSync("agent", ["--version"], { encoding: "utf8" });
  if ((r.status ?? 1) !== 0) {
    const msg =
      (r.stderr ?? "").trim() ||
      (r.stdout ?? "").trim() ||
      (r.error instanceof Error ? r.error.message : "") ||
      `agent --version failed (exit=${r.status ?? 1})`;
    if (!require) {
      return {
        name: "cursor.cli",
        ok: false,
        required: false,
        skipped: true,
        error: { message: msg },
        details: { note: "Not required (set AGNET_SELF_CHECK_REQUIRE_CURSOR_CLI=1 to require)." },
      };
    }
    return { name: "cursor.cli", ok: false, required: true, error: { message: msg } };
  }
  return { name: "cursor.cli", ok: true, required: require, details: { version: (r.stdout ?? "").trim() } };
}

async function checkCursorCloudApi(): Promise<SelfCheckItem> {
  const apiKey = readEnv("CURSOR_API_KEY");
  const require = isRequireCursorApi();
  if (!apiKey) {
    if (!require) {
      return {
        name: "cursor.api.models",
        ok: false,
        required: false,
        skipped: true,
        error: { message: "CURSOR_API_KEY is not set." },
        details: { note: "Not required (set AGNET_SELF_CHECK_REQUIRE_CURSOR_API=1 to require)." },
      };
    }
    return { name: "cursor.api.models", ok: false, required: true, error: { message: "CURSOR_API_KEY is not set." } };
  }

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
    `Authorization:Bearer ${apiKey}`,
  ];

  const client = new McpStdioClient(cmd, args);
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "tempybot-selfcheck", version: "0.0.0" },
    });
    if (init.error) {
      return { name: "cursor.api.models", ok: false, required: true, error: { message: init.error.message } };
    }
    client.notify("notifications/initialized", {});

    const call = await client.request("tools/call", {
      name: "invoke-api-endpoint",
      arguments: { endpoint: "/v0/models", method: "GET", params: {} },
    });
    if (call.error) {
      return { name: "cursor.api.models", ok: false, required: true, error: { message: call.error.message } };
    }

    const parsed = parseToolTextJson(call.result) as any;
    const models = Array.isArray(parsed?.models) ? parsed.models : null;
    if (!models || !models.length) {
      return {
        name: "cursor.api.models",
        ok: false,
        required: true,
        error: { message: "Cursor API call succeeded but no models were returned." },
      };
    }

    return { name: "cursor.api.models", ok: true, required: true, details: { modelsCount: models.length } };
  } catch (err) {
    return {
      name: "cursor.api.models",
      ok: false,
      required: true,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runSelfCheck(): Promise<SelfCheckReport> {
  const checks: SelfCheckItem[] = [];
  checks.push(await checkMcpOpenApiSchema());
  checks.push(await checkGitHubViaGh());
  checks.push(checkCursorCli());
  checks.push(await checkCursorCloudApi());

  const ok = !checks.some(shouldFail);
  return { ok, checks };
}

