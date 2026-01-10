import { expect, test } from "vitest";
import path from "node:path";
import { CliSession, userSleep } from "../../test-utils.js";

test("cli scenario (integration): interactive mode tool call + memory", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const cli = new CliSession(process.execPath, [script, "interactive"], process.cwd());

  try {
    await cli.waitFor("Interactive mode");
    await cli.waitFor("> ");

    // Run tool in interactive mode.
    cli.write("/tool random\r");
    await cli.waitFor(/Random number:\s*\d+/);
    await userSleep(200);

    const out1 = cli.output();
    const m = out1.match(/Random number:\s*(\d+)/);
    expect(m).toBeTruthy();
    const n = Number(m?.[1]);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1000);

    // Ask agent to recall from history.
    cli.write("what number did you generate?\r");
    await cli.waitFor(`Remembered number: ${n}`);

    // Clean exit.
    cli.write("/exit\r");
    const { exitCode } = await cli.waitForExit(60_000);
    expect(exitCode).toBe(0);
  } finally {
    cli.kill();
  }
});

