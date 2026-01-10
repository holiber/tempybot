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

  it("run --world prints Nothing to do when no /myagent commands (fixture)", () => {
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
    const json = parseJsonStdout<{ ok: true; command: "run"; result: "nothing"; message: string }>(res);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("run");
    expect(json.result).toBe("nothing");
    expect(json.message).toContain("Nothing to do");
  });

  it("run --world prints Found command when /myagent command exists (fixture)", () => {
    const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
    const idemPath = makeTempFilePath("idempotency");
    const res = runAgnet(
      ["--json", "--templates", template, "run", "--world"],
      {
        AGNET_GH_FIXTURE_PATH: "fixtures/gh_issue_comments_myagent_resolve.json",
        AGNET_IDEMPOTENCY_PATH: idemPath,
      }
    );
    expect(res.code, combinedOutput(res)).toBe(0);
    const json = parseJsonStdout<{
      ok: true;
      command: "run";
      result: "wake";
      message: string;
      foundCommand: { agent: string; name: string; args: string[]; commentId: number };
    }>(res);
    expect(json.ok).toBe(true);
    expect(json.command).toBe("run");
    expect(json.result).toBe("wake");
    expect(json.message).toContain("Found command: resolve");
    expect(json.foundCommand.agent).toBe("myagent");
    expect(json.foundCommand.name).toBe("resolve");
    expect(Array.isArray(json.foundCommand.args)).toBe(true);
    expect(json.foundCommand.commentId).toBeTruthy();
  });

  it("run --world idempotency prevents rerun for same commentId (same store)", () => {
    const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
    const idemPath = makeTempFilePath("idempotency");
    const env = {
      AGNET_GH_FIXTURE_PATH: "fixtures/gh_issue_comments_myagent_resolve.json",
      AGNET_IDEMPOTENCY_PATH: idemPath,
    };

    const res1 = runAgnet(["--json", "--templates", template, "run", "--world"], env);
    expect(res1.code, combinedOutput(res1)).toBe(0);
    expect(res1.stdout).toContain("Found command:");

    const res2 = runAgnet(["--json", "--templates", template, "run", "--world"], env);
    expect(res2.code, combinedOutput(res2)).toBe(0);
    expect(res2.stdout).toContain("Nothing to do");
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

