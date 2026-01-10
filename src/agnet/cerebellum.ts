import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import { ChannelFactory, type IChannel } from "../stc/light/channel.js";

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

async function readFixtureText(fixturePath: string, cwd: string): Promise<string> {
  const abs = path.isAbsolute(fixturePath) ? fixturePath : path.resolve(cwd, fixturePath);
  return await fs.readFile(abs, "utf8");
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
    return { ok: true, stdout };
  }

  // Tier 1: fixture-driven only. Avoid network/auth requirements in CI.
  return {
    ok: false,
    error: {
      message:
        "MCP fixture mode is required in Tier 1. Set AGNET_MCP_FIXTURE_PATH to a JSON fixture response.",
    },
  };
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

