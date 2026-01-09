import { expect, test } from "vitest";
import { CliSession, userSleep, userTypeDelay } from "../../../test-utils";

test("cli scenario (integration): prints hello", async () => {
  // In a real project this scenario would require secrets / real external services.
  // Keep it simple and deterministic in this template repo.
  const cli = new CliSession(process.execPath, ["-e", "console.log('Hello, world!')"], process.cwd());

  try {
    await cli.waitFor("Hello, world!");
    await userSleep();
    expect(cli.output()).toContain("Hello, world!");

    // Example of user-like typing (no-op for this minimal command).
    await cli.typeCharByChar("", () => userTypeDelay(40));
  } finally {
    cli.kill();
  }
});

