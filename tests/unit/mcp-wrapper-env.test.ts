import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

type DryRunOut = { cmd: string; hasAuthHeader: boolean; args: string[] };

function runMcpWrapper(env: Record<string, string | undefined>): { code: number; stdout: string; stderr: string } {
  const script = path.join(process.cwd(), "scripts", "mcp-cursor-cloud-agents.mjs");
  const r = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0", MCP_DRY_RUN: "1", ...env },
    encoding: "utf8",
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function parseJson(r: { stdout: string; stderr: string }): DryRunOut {
  const raw = r.stdout.trim();
  if (!raw) throw new Error(`Expected JSON on stdout.\n\nstderr:\n${r.stderr}`);
  return JSON.parse(raw) as DryRunOut;
}

describe("mcp-cursor-cloud-agents wrapper (dry run)", () => {
  it("adds Authorization header when CURSORCLOUDAPIKEY is set (redacted)", () => {
    const secret = "key_0123456789abcdef";
    const res = runMcpWrapper({ CURSORCLOUDAPIKEY: secret });
    expect(res.code).toBe(0);
    const out = parseJson(res);
    expect(out.cmd).toBe("npx");
    expect(out.hasAuthHeader).toBe(true);
    expect(out.args.join(" ")).toContain("--headers");
    expect(out.args.join(" ")).toContain("Authorization: Bearer <redacted>");
    expect(out.args.join(" ")).not.toContain(secret);
  });

  it("does not add Authorization header when no Cursor key is set", () => {
    const res = runMcpWrapper({});
    expect(res.code).toBe(0);
    const out = parseJson(res);
    expect(out.hasAuthHeader).toBe(false);
    expect(out.args.includes("--headers")).toBe(false);
  });
});

