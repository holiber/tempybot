import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("cli scenario: prints hello", () => {
  const r = spawnSync(process.execPath, ["-e", "console.log('Hello, world!')"], {
    encoding: "utf8",
  });

  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toBe("Hello, world!");
});

