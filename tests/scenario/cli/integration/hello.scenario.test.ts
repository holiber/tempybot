import { expect, test } from "vitest";
import path from "node:path";
import { CliSession, userSleep, userTypeDelay } from "../../../test-utils.js";

test("cli scenario (integration): asks name and greets", async () => {
  // In a real project this scenario would validate gated integrations.
  // Keep it deterministic here while still being user-like and informative.
  const script = path.join(process.cwd(), "scripts", "cli-scenario.mjs");
  const cli = new CliSession(process.execPath, [script], process.cwd());

  try {
    await cli.waitFor("What's your name");
    await userSleep(600);
    await cli.typeCharByChar("anonymous", () => userTypeDelay());
    cli.write("\r");

    await cli.waitFor("Hello anonymous!");
    await userSleep(1200);

    const out = cli.output();
    expect(out).toContain("What's your name");
    expect(out).toContain("Hello anonymous!");
    expect(out).toContain("\u001b[40m"); // dark background
    expect(out).toContain("\u001b[92m"); // bright green foreground
  } finally {
    cli.kill();
  }
});

