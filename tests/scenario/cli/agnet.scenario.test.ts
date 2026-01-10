/**
 * CLI scenario tests.
 *
 * IMPORTANT:
 * - These tests run the CLI inside a PTY (see `CliSession`).
 * - To keep output deterministic, we force JSON output mode and assert only on parsed JSON.
 *
 * Unit tests covering the same CLI contract live in: `tests/unit/agnet-cli.test.ts`
 */

import path from "node:path";
import { expect, test } from "vitest";
import { CliSession } from "../test-utils.js";

function stripAnsi(s: string): string {
  // Minimal ANSI stripping for robustness with PTY output.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseLastJsonObject<T>(rawOutput: string): T {
  const out = stripAnsi(rawOutput).replace(/\r/g, "").trim();
  if (!out) throw new Error(`Expected JSON output, got empty output.`);

  // agnet.ts prints a single JSON object, but PTY output can include extra whitespace.
  // Be defensive and parse the outermost {...} block.
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Expected JSON object in output.\n\nRaw output:\n${out}`);
  }

  const jsonText = out.slice(start, end + 1);
  try {
    return JSON.parse(jsonText) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from output: ${e instanceof Error ? e.message : String(e)}\n\nRaw output:\n${out}`
    );
  }
}

test("agnet doctor prints templates count (json)", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
  const cli = new CliSession(process.execPath, [script, "--json", "--templates", template, "doctor"], process.cwd());

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    expect(exitCode).toBe(0);

    const json = parseLastJsonObject<{
      ok: true;
      command: "doctor";
      templatesLoaded: number;
      templates: string[];
    }>(cli.output());

    expect(json.ok).toBe(true);
    expect(json.command).toBe("doctor");
    expect(json.templatesLoaded).toBe(1);
    expect(json.templates).toEqual(["agents/repoboss.agent.md"]);
  } finally {
    cli.kill();
  }
});

test("agnet run --world prints stub world (json)", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
  const cli = new CliSession(
    process.execPath,
    [script, "--json", "--templates", template, "run", "--world"],
    process.cwd()
  );

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    expect(exitCode).toBe(0);

    const json = parseLastJsonObject<{ ok: true; command: "run"; world: { items: number } }>(cli.output());
    expect(json.ok).toBe(true);
    expect(json.command).toBe("run");
    expect(json.world.items).toBe(0);
  } finally {
    cli.kill();
  }
});

test("missing --templates path fails with a helpful error (json)", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const missing = path.join(process.cwd(), "agents", "does-not-exist.agent.md");
  const cli = new CliSession(process.execPath, [script, "--json", "--templates", missing, "doctor"], process.cwd());

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    expect(exitCode).not.toBe(0);

    const json = parseLastJsonObject<{ ok: false; error: { message: string } }>(cli.output());
    expect(json.ok).toBe(false);
    expect(json.error.message).toMatch(/--templates/i);
    expect(json.error.message).toMatch(/not found/i);
  } finally {
    cli.kill();
  }
});

test("tools prints help and exits non-zero on wrong usage (json)", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const cli = new CliSession(process.execPath, [script, "--json", "tools", "nope"], process.cwd());

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    expect(exitCode).toBe(2);

    const json = parseLastJsonObject<{
      ok: false;
      command: "tools";
      error: { message: string };
      help: string;
    }>(cli.output());

    expect(json.ok).toBe(false);
    expect(json.command).toBe("tools");
    expect(json.error.message).toMatch(/Unknown tools command/i);
    expect(json.help).toContain("agnet.ts tools");
  } finally {
    cli.kill();
  }
});

