import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { ChannelFactory, type IChannel } from "../stc/light/channel.js";
import { McpStdioClient, openApiMcpServerCommand } from "./mcp-stdio-client.ts";

export type CerebellumActor = { role: "agent" | "user" | "system"; id?: string };

export type CerebellumToolName = "gh" | "mcp";

export type CerebellumToolRequest =
  | { tool: "gh"; args: string[] }
  | { tool: "mcp"; method: string; args: unknown; specPath: string };

export type CerebellumToolResult =
  | { ok: true; stdout: string }
  | { ok: false; error: { message: string }; blocked?: boolean };

export type CerebellumEvent<M extends Record<string, unknown> = Record<string, unknown>, P = unknown> = {
  type: string;
  payload?: P;
  meta?: M;
};

export type CerebellumHook<
  E extends CerebellumEvent = CerebellumEvent,
  Ctx extends Record<string, unknown> = Record<string, unknown>,
> = (event: E, ctx: Ctx) => Promise<E | null | void> | E | null | void;

export type CerebellumStreamEvent =
  | { type: "log"; payload: { message: string; level?: "info" | "warn" | "error" } }
  | { type: "world.snapshot"; payload: unknown }
  | { type: "tool.request"; payload: { request: CerebellumToolRequest; actor?: CerebellumActor; intention?: string } }
  | { type: "tool.result"; payload: { request: CerebellumToolRequest; result: CerebellumToolResult } };

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function readCursorApiKey(): string | undefined {
  return readEnv("CURSOR_API_KEY") ?? readEnv("CURSOR_CLOUD_API_KEY") ?? readEnv("CURSORCLOUDAPIKEY");
}

async function readFixtureText(fixturePath: string, cwd: string): Promise<string> {
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.resolve(cwd, fixturePath);
  return await fs.readFile(abs, "utf8");
}

async function inferApiBaseUrlFromOpenApiSpec(specAbsPath: string): Promise<string> {
  const override = readEnv("AGNET_MCP_API_BASE_URL");
  if (override) return override;

  // Best-effort: read `servers[0].url` from OpenAPI YAML.
  try {
    const raw = await fs.readFile(specAbsPath, "utf8");
    const yamlMod = await import("yaml");
    const parse = (yamlMod as any)?.parse as ((s: string) => unknown) | undefined;
    if (typeof parse !== "function") return "https://api.cursor.com";
    const doc = parse(raw) as any;
    const url = doc?.servers?.[0]?.url;
    if (typeof url === "string" && url.trim()) return url.trim();
  } catch {
    // ignore
  }

  return "https://api.cursor.com";
}

function toolCallResultToStdout(result: unknown): string {
  const root = result && typeof result === "object" ? (result as any) : null;
  const content = Array.isArray(root?.content) ? root.content : null;
  const text = typeof content?.[0]?.text === "string" ? String(content[0].text) : "";
  if (text.trim()) return text;

  try {
    return `${JSON.stringify(result ?? null, null, 2)}\n`;
  } catch {
    return `${String(result ?? "")}\n`;
  }
}

export async function executeGh(args: string[], opts?: { cwd?: string }): Promise<CerebellumToolResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const fixturePath = readEnv("AGNET_GH_FIXTURE_CMD");
  if (fixturePath) {
    const stdout = await readFixtureText(fixturePath, cwd);
    return { ok: true, stdout };
  }

  const r = spawnSync("gh", args, {
    cwd,
    env: { ...process.env, FORCE_COLOR: "0" },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });

  const code = r.status ?? 1;
  if (code !== 0) {
    const stderr = (r.stderr ?? "").trim();
    const stdout = (r.stdout ?? "").trim();
    const msg = stderr || stdout || `gh failed (exit=${code})`;
    return { ok: false, error: { message: msg } };
  }

  return { ok: true, stdout: r.stdout ?? "" };
}

export async function executeMcpCall(
  input: { method: string; args: unknown; specPath: string },
  opts?: { cwd?: string }
): Promise<CerebellumToolResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const fixturePath = readEnv("AGNET_MCP_FIXTURE_PATH");
  if (fixturePath) {
    const stdout = await readFixtureText(fixturePath, cwd);
    // Allow fixture-driven failures for deterministic tests.
    // Convention: if the fixture JSON contains { ok: false, error: { message } }, treat it as a tool failure.
    try {
      const parsed = JSON.parse(stdout) as any;
      if (parsed && typeof parsed === "object" && parsed.ok === false) {
        const msg =
          typeof parsed?.error?.message === "string" && parsed.error.message.trim()
            ? parsed.error.message.trim()
            : "MCP fixture reported ok=false.";
        return { ok: false, error: { message: msg } };
      }
    } catch {
      // Non-JSON fixtures are treated as plain stdout.
    }
    return { ok: true, stdout };
  }

  const specAbs = path.isAbsolute(input.specPath) ? input.specPath : path.resolve(cwd, input.specPath);
  const apiBaseUrl = await inferApiBaseUrlFromOpenApiSpec(specAbs);
  const apiKey = readCursorApiKey();

  const { cmd, argsPrefix } = openApiMcpServerCommand();
  const args = [
    ...argsPrefix,
    "--transport",
    "stdio",
    "--tools",
    "dynamic",
    "--openapi-spec",
    specAbs,
    "--api-base-url",
    apiBaseUrl,
    "--name",
    "agnet-openapi",
    "--server-version",
    "0.1.0",
  ];
  if (apiKey) {
    // openapi-mcp-server expects `Authorization:Bearer <token>` (no space after colon).
    args.push("--headers", `Authorization:Bearer ${apiKey}`);
  }

  const client = new McpStdioClient(cmd, args, { cwd });
  try {
    const init = await client.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "agnet", version: "0.1.0" },
    });
    if (init.error) {
      return { ok: false, error: { message: init.error.message } };
    }
    client.notify("notifications/initialized", {});

    const call = await client.request("tools/call", { name: input.method, arguments: input.args });
    if (call.error) {
      return { ok: false, error: { message: call.error.message } };
    }

    return { ok: true, stdout: toolCallResultToStdout(call.result) };
  } catch (err) {
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err) } };
  } finally {
    await client.close().catch(() => {});
  }
}

export class Cerebellum<Ctx extends Record<string, unknown> = Record<string, unknown>> {
  public readonly channel: IChannel<CerebellumStreamEvent>;

  private readonly hooksAll: Array<CerebellumHook<CerebellumEvent, Ctx>> = [];
  private readonly hooksByType = new Map<string, Array<CerebellumHook<CerebellumEvent, Ctx>>>();

  public constructor(init?: { channel?: IChannel<CerebellumStreamEvent> }) {
    this.channel = init?.channel ?? new ChannelFactory().create<CerebellumStreamEvent>({ id: "cerebellum" });
  }

  public use(hook: CerebellumHook<CerebellumEvent, Ctx>): void {
    this.hooksAll.push(hook);
  }

  public on(type: string, hook: CerebellumHook<CerebellumEvent, Ctx>): void {
    const arr = this.hooksByType.get(type) ?? [];
    arr.push(hook);
    this.hooksByType.set(type, arr);
  }

  public emit(event: CerebellumStreamEvent): void {
    this.channel.send(event);
  }

  public log(message: string, level: "info" | "warn" | "error" = "info"): void {
    this.emit({ type: "log", payload: { message, level } });
  }

  public worldSnapshot(snapshot: unknown): void {
    this.emit({ type: "world.snapshot", payload: snapshot });
  }

  public async dispatch(event: CerebellumEvent, ctx: Ctx): Promise<CerebellumEvent | null> {
    const chain = [...this.hooksAll, ...(this.hooksByType.get(event.type) ?? [])];
    let current: CerebellumEvent | null = event;
    for (const hook of chain) {
      if (!current) break;
      const out = await hook(current, ctx);
      if (out === null) {
        current = null;
        break;
      }
      if (out !== undefined) current = out;
    }
    return current;
  }

  public async executeTool(
    request: CerebellumToolRequest,
    meta?: { actor?: CerebellumActor; intention?: string; cwd?: string; ctx: Ctx }
  ): Promise<{ result: CerebellumToolResult; channel: IChannel<CerebellumStreamEvent> }> {
    const evt: CerebellumEvent = {
      type: "tool.request",
      payload: { request, actor: meta?.actor, intention: meta?.intention },
    };

    this.emit({ type: "tool.request", payload: { request, actor: meta?.actor, intention: meta?.intention } });

    const passed = await this.dispatch(evt, meta?.ctx as Ctx);
    if (!passed) {
      const result: CerebellumToolResult = {
        ok: false,
        blocked: true,
        error: { message: "Tool request was blocked by hook chain." },
      };
      this.emit({ type: "tool.result", payload: { request, result } });
      return { result, channel: this.channel };
    }

    const effective = (passed.payload as any)?.request ?? request;
    const cwd = meta?.cwd ?? process.cwd();

    const result =
      effective?.tool === "gh"
        ? await executeGh((effective as any).args ?? [], { cwd })
        : await executeMcpCall(
            { method: (effective as any).method, args: (effective as any).args, specPath: (effective as any).specPath },
            { cwd }
          );

    this.emit({ type: "tool.result", payload: { request: effective, result } });
    return { result, channel: this.channel };
  }
}

