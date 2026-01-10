import { expect, test } from "vitest";
import path from "node:path";
import { CliSession, userSleep, userTypeDelay } from "../../test-utils.js";

test("cli scenario: asks name and greets", async () => {
  const script = path.join(process.cwd(), "scripts", "cli-scenario.mjs");
  const cli = new CliSession(process.execPath, [script], process.cwd());

  try {
    await cli.waitFor("What's your name");
    // Give the recording and userlike mode a real "settle" moment.
    await userSleep();
    await userSleep(600);
    await cli.typeCharByChar("anonymous", () => userTypeDelay());
    cli.write("\r");

    await cli.waitFor("Hello anonymous!");
    await userSleep(1200);

    // Verify output is present and includes terminal styling escapes.
    const out = cli.output();
    expect(out).toContain("What's your name");
    expect(out).toContain("Hello anonymous!");
    expect(out).toContain("\u001b[40m"); // dark background
    expect(out).toContain("\u001b[92m"); // bright green foreground

    // End-of-scenario settle (still inside the recorded session for CLI).
    await userSleep();
  } finally {
    cli.kill();
  }
});

