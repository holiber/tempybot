import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import process from "node:process";

type JsonRpcId = number | string;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isJsonRpcResponse(v: unknown): v is JsonRpcResponse {
  return isObject(v) && v.jsonrpc === "2.0" && ("result" in v || "error" in v) && "id" in v;
}

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<JsonRpcId, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private stderrBuffer = "";

  public constructor(cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) {
    this.child = spawn(cmd, args, {
      cwd: opts?.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts?.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = readline.createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const txt = line.trim();
      if (!txt) return;
      let msg: unknown;
      try {
        msg = JSON.parse(txt) as unknown;
      } catch {
        // Ignore non-JSON lines (some servers may print logs to stdout).
        return;
      }
      if (!isJsonRpcResponse(msg)) return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      waiter.resolve(msg);
    });

    this.child.stderr.on("data", (buf) => {
      this.stderrBuffer += String(buf);
      if (this.stderrBuffer.length > 256_000) {
        this.stderrBuffer = this.stderrBuffer.slice(-256_000);
      }
    });

    this.child.on("exit", (code, signal) => {
      const err = new Error(
        `MCP server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).` +
          (this.stderrBuffer.trim() ? `\n\nstderr:\n${this.stderrBuffer.trim()}\n` : "")
      );
      for (const [, waiter] of this.pending.entries()) waiter.reject(err);
      this.pending.clear();
    });
  }

  public async close(): Promise<void> {
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
  }

  public notify(method: string, params?: unknown): void {
    const req: JsonRpcRequest = { jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) };
    this.child.stdin.write(`${JSON.stringify(req)}\n`);
  }

  public async request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };

    const p = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.child.stdin.write(`${JSON.stringify(req)}\n`);
    return await p;
  }
}

export function openApiMcpServerCommand(): { cmd: string; argsPrefix: string[] } {
  const bin = path.join(process.cwd(), "node_modules", "@ivotoby", "openapi-mcp-server", "bin", "mcp-server.js");
  return { cmd: process.execPath, argsPrefix: [bin] };
}

