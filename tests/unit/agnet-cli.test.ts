import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runAgnet(args: string[]): RunResult {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0" },
    encoding: "utf8",
  });

  return {
    code: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function combinedOutput(r: RunResult): string {
  return `stdout:\n${r.stdout}\n\nstderr:\n${r.stderr}\n`;
}

describe("agnet.ts CLI (unit)", () => {
  it("doctor prints header and template count", () => {
    const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
    const res = runAgnet(["--templates", template, "doctor"]);
    expect(res.code, combinedOutput(res)).toBe(0);
    expect(res.stdout).toContain("Doctor");
    expect(res.stdout).toContain("Templates loaded: 1");
  });

  it("run --world prints stub world", () => {
    const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
    const res = runAgnet(["--templates", template, "run", "--world"]);
    expect(res.code, combinedOutput(res)).toBe(0);
    expect(res.stdout).toContain("WORLD");
    expect(`${res.stdout}${res.stderr}`).toMatch(/items:\s*0/);
  });

  it("missing --templates path fails with a helpful error", () => {
    const missing = path.join(process.cwd(), "agents", "does-not-exist.agent.md");
    const res = runAgnet(["--templates", missing, "doctor"]);
    expect(res.code).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/--templates/i);
    expect(`${res.stdout}${res.stderr}`).toMatch(/not found/i);
  });

  it("tools prints help and exits non-zero on wrong usage", () => {
    const res = runAgnet(["tools", "nope"]);
    expect(res.code).toBe(2);
    expect(res.stdout).toContain("agnet.ts tools");
    expect(`${res.stdout}${res.stderr}`).toMatch(/Unknown tools command/i);
  });
});

