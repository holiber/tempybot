import { expect, test } from "vitest";
import path from "node:path";
import { CliSession } from "../../test-utils.js";

test("agnet doctor prints header and template count", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const template = path.join(process.cwd(), "agents", "repoboss.agent.md");
  const cli = new CliSession(process.execPath, [script, "--templates", template, "doctor"], process.cwd());

  try {
    await cli.waitFor("Doctor");
    await cli.waitFor("Templates loaded: 1");

    const { exitCode } = await cli.waitForExit();
    expect(exitCode).toBe(0);
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
    await cli.waitFor("WORLD");
    await cli.waitFor(/items:\s*0/);

    const { exitCode } = await cli.waitForExit();
    expect(exitCode).toBe(0);
  } finally {
    cli.kill();
  }
});

test("missing --templates path fails with a helpful error", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const missing = path.join(process.cwd(), "agents", "does-not-exist.agent.md");
  const cli = new CliSession(process.execPath, [script, "--templates", missing, "doctor"], process.cwd());

  try {
    await cli.waitFor(/--templates/i);
    await cli.waitFor(/not found/i);

    const { exitCode } = await cli.waitForExit();
    expect(exitCode).not.toBe(0);
  } finally {
    cli.kill();
  }
});

test("tools prints help and exits non-zero on wrong usage", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const cli = new CliSession(process.execPath, [script, "tools", "nope"], process.cwd());

  try {
    await cli.waitFor("agnet.ts tools");
    await cli.waitFor(/Unknown tools command/i);

    const { exitCode } = await cli.waitForExit();
    expect(exitCode).toBe(2);
  } finally {
    cli.kill();
  }
});

