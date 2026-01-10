import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runAgnet(args: string[], env?: Record<string, string | undefined>): RunResult {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0", ...(env ?? {}) },
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

function parseJsonStdout<T>(r: RunResult): T {
  const raw = r.stdout.trim();
  if (!raw) throw new Error(`Expected JSON on stdout.\n\n${combinedOutput(r)}`);
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from stdout: ${e instanceof Error ? e.message : String(e)}\n\n${combinedOutput(r)}`
    );
  }
}

function makeTempFilePath(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agnet-cli-"));
  return path.join(dir, `${prefix}.json`);
}

describe("agnet.ts CLI (unit)", () => {
  it("doctor prints header and template count", () => {
    const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
    const res = runAgnet(["--json", "--templates", template, "doctor"]);
    expect(res.code, combinedOutput(res)).toBe(0);
    const json = parseJsonStdout<{
      ok: true;
      command: "doctor";
      templatesLoaded: number;
      templates: string[];
    }>(res);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("doctor");
    expect(json.templatesLoaded).toBe(1);
    expect(json.templates).toEqual(["agents/repoboss.agent.md"]);
  });

  it("run --world prints World snapshot JSON (fixture)", () => {
    const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
    const idemPath = makeTempFilePath("idempotency");
    const res = runAgnet(
      ["--json", "--templates", template, "run", "--world"],
      {
        AGNET_GH_FIXTURE_PATH: "fixtures/gh_issue_comments.json",
        AGNET_IDEMPOTENCY_PATH: idemPath,
      }
    );
    expect(res.code, combinedOutput(res)).toBe(0);
    const json = parseJsonStdout<{ items: Array<{ kind: string; meta?: Record<string, unknown> }>; ts: string }>(res);
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.items.length).toBe(2);
    expect(json.items[0]!.kind).toBe("comment");
    expect((json.items[0]!.meta as any)?.repo).toBeTruthy();
    expect((json.items[0]!.meta as any)?.commentId).toBeTruthy();

    // Idempotency: rerunning with the same store should be a no-op.
    const res2 = runAgnet(
      ["--json", "--templates", template, "run", "--world"],
      {
        AGNET_GH_FIXTURE_PATH: "fixtures/gh_issue_comments.json",
        AGNET_IDEMPOTENCY_PATH: idemPath,
      }
    );
    expect(res2.code, combinedOutput(res2)).toBe(0);
    const json2 = parseJsonStdout<{ items: Array<unknown> }>(res2);
    expect(Array.isArray(json2.items)).toBe(true);
    expect(json2.items.length).toBe(0);
  });

  it("missing --templates path fails with a helpful error", () => {
    const missing = path.join(process.cwd(), "agents", "does-not-exist.agent.md");
    const res = runAgnet(["--json", "--templates", missing, "doctor"]);
    expect(res.code).not.toBe(0);
    const json = parseJsonStdout<{ ok: false; error: { message: string } }>(res);
    expect(json.ok).toBe(false);
    expect(json.error.message).toMatch(/--templates/i);
    expect(json.error.message).toMatch(/not found/i);
  });

  it("tools prints help and exits non-zero on wrong usage", () => {
    const res = runAgnet(["--json", "tools", "nope"]);
    expect(res.code).toBe(2);
    const json = parseJsonStdout<{
      ok: false;
      command: "tools";
      error: { message: string };
      help: string;
    }>(res);
    expect(json.ok).toBe(false);
    expect(json.command).toBe("tools");
    expect(json.error.message).toMatch(/Unknown tools command/i);
    expect(json.help).toContain("agnet.ts tools");
  });
});

