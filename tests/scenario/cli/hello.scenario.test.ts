import { expect, test } from "vitest";
import { CliSession, userSleep, userTypeDelay } from "../../test-utils.js";

test("cli scenario: prints hello", async () => {
  const cli = new CliSession(process.execPath, ["-e", "console.log('Hello, world!')"], process.cwd());

  try {
    await cli.waitFor("Hello, world!");
    await userSleep(200);
    expect(cli.output()).toContain("Hello, world!");

    // Demonstrate "user-like" timing primitives (no-op input).
    await cli.typeCharByChar("", () => userTypeDelay(40));
  } finally {
    cli.kill();
  }
});

