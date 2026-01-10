import { expect, test } from "vitest";
import path from "node:path";
import { CliSession } from "../../test-utils.js";

test("agnet doctor prints header and template count", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
  const cli = new CliSession(process.execPath, [script, "--templates", template, "doctor"], process.cwd());

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    const out = cli.output();

    expect(exitCode).toBe(0);
    expect(out).toContain("Doctor");
    expect(out).toContain("Templates loaded: 1");
  } finally {
    cli.kill();
  }
});

test("agnet run --world prints stub world", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
  const cli = new CliSession(
    process.execPath,
    [script, "--templates", template, "run", "--world"],
    process.cwd()
  );

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    const out = cli.output();

    expect(exitCode).toBe(0);
    expect(out).toContain("WORLD");
    expect(out).toMatch(/items:\s*0/);
  } finally {
    cli.kill();
  }
});

test("missing --templates path fails with a helpful error", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const missing = path.join(process.cwd(), "agents", "does-not-exist.agent.md");
  const cli = new CliSession(process.execPath, [script, "--templates", missing, "doctor"], process.cwd());

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    const out = cli.output();

    expect(exitCode).not.toBe(0);
    expect(out).toMatch(/--templates/i);
    expect(out).toMatch(/not found/i);
  } finally {
    cli.kill();
  }
});

test("tools prints help and exits non-zero on wrong usage", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const cli = new CliSession(process.execPath, [script, "tools", "nope"], process.cwd());

  try {
    const { exitCode } = await cli.waitForExit(60_000);
    const out = cli.output();

    expect(exitCode).toBe(2);
    expect(out).toContain("agnet.ts tools");
    expect(out).toMatch(/Unknown tools command/i);
  } finally {
    cli.kill();
  }
});

