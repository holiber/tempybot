import { expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { CliSession, userSleep } from "../../test-utils.js";

test("cli scenario (integration): single prompt + conversation + tool + fa", async () => {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const cli = new CliSession(process.execPath, [script, "interactive"], process.cwd());

  try {
    await cli.waitFor("Interactive mode");
    await cli.waitFor("> ");

    // Single prompt -> agent responds.
    cli.write("hello\r");
    await cli.waitFor(/Unknown input\./);
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

    // File-access ("fa") tool.
    cli.write("/tool fa\r");
    await cli.waitFor(/FA ok: wrote \.agnet\/fa-tool\.txt and read "hello-from-fa"/);
    const faPath = path.join(process.cwd(), ".agnet", "fa-tool.txt");
    expect(fs.existsSync(faPath)).toBe(true);
    // Best-effort cleanup for local runs / CI.
    try {
      fs.unlinkSync(faPath);
      fs.rmdirSync(path.dirname(faPath));
    } catch {
      // ignore
    }

    // Clean exit.
    cli.write("/exit\r");
    const { exitCode } = await cli.waitForExit(60_000);
    expect(exitCode).toBe(0);
  } finally {
    cli.kill();
  }
});

