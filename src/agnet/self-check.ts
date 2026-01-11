import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
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

function isRequirePlaywrightMcpServer(): boolean {
  return readEnv("AGNET_SELF_CHECK_REQUIRE_PLAYWRIGHT_MCP") === "1";
}

function isRequireChromeDevtoolsMcpServer(): boolean {
  return readEnv("AGNET_SELF_CHECK_REQUIRE_CHROME_DEVTOOLS_MCP") === "1";
}

function shouldFail(item: SelfCheckItem): boolean {
  return item.ok ? false : item.required;
}

async function statSafe(p: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function readSelfCheckAgentConfigUseMcp(): Promise<{ playwright: boolean; chromeDevtools: boolean } | null> {
  const p = readEnv("AGNET_SELF_CHECK_AGENT_YML");
  if (!p) return null;

  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  try {
    const raw = await fs.readFile(abs, "utf8");
    const yamlMod = await import("yaml");
    const parse = (yamlMod as any)?.parse as ((s: string) => unknown) | undefined;
    if (typeof parse !== "function") return null;
    const doc = parse(raw) as any;

    const useMcp = (doc?.use_mcp ?? doc?.useMcp) as any;
    const playwright = Boolean(useMcp?.playwright);
    const chromeDevtools = Boolean(useMcp?.chrome_devtools ?? useMcp?.chromeDevtools);
    return { playwright, chromeDevtools };
  } catch {
    return null;
  }
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

async function checkNodeScriptTool(args: {
  name: string;
  required: boolean;
  relScriptPath: string;
  helpArgs?: string[];
}): Promise<SelfCheckItem> {
  const absScriptPath = path.join(process.cwd(), args.relScriptPath);
  const st = await statSafe(absScriptPath);
  if (!st || !st.isFile()) {
    const msg = `Missing file: ${args.relScriptPath}`;
    if (!args.required) {
      return {
        name: args.name,
        ok: false,
        required: false,
        skipped: true,
        error: { message: msg },
        details: { note: "Not required (enable in agent.yml or set AGNET_SELF_CHECK_REQUIRE_*=1 to require)." },
      };
    }
    return { name: args.name, ok: false, required: true, error: { message: msg } };
  }

  const r = spawnSync(process.execPath, [absScriptPath, ...(args.helpArgs ?? ["--help"])], {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0" },
    maxBuffer: 10 * 1024 * 1024,
  });
  if ((r.status ?? 1) !== 0) {
    const msg =
      (r.stderr ?? "").trim() ||
      (r.stdout ?? "").trim() ||
      (r.error instanceof Error ? r.error.message : "") ||
      `node ${args.relScriptPath} failed (exit=${r.status ?? 1})`;
    if (!args.required) {
      return {
        name: args.name,
        ok: false,
        required: false,
        skipped: true,
        error: { message: msg },
        details: { note: "Not required (enable in agent.yml or set AGNET_SELF_CHECK_REQUIRE_*=1 to require)." },
      };
    }
    return { name: args.name, ok: false, required: true, error: { message: msg } };
  }

  return { name: args.name, ok: true, required: args.required };
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
  const agentCfg = await readSelfCheckAgentConfigUseMcp();

  const checks: SelfCheckItem[] = [];
  checks.push(await checkMcpOpenApiSchema());
  checks.push(await checkGitHubViaGh());
  checks.push(checkCursorCli());
  checks.push(
    await checkNodeScriptTool({
      name: "mcp.playwright",
      required: isRequirePlaywrightMcpServer() || Boolean(agentCfg?.playwright),
      relScriptPath: "node_modules/@playwright/mcp/cli.js",
    })
  );
  checks.push(
    await checkNodeScriptTool({
      name: "mcp.chrome-devtools",
      required: isRequireChromeDevtoolsMcpServer() || Boolean(agentCfg?.chromeDevtools),
      relScriptPath: "node_modules/chrome-devtools-mcp/build/src/index.js",
    })
  );
  checks.push(await checkCursorCloudApi());

  const ok = !checks.some(shouldFail);
  return { ok, checks };
}

