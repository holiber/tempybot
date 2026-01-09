import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "tempybot-cli-"));
}

describe("cli: tempybot agent parse", () => {
  it("prints NDJSON to stdout with --stdout", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "one.agent.md");
    await fs.writeFile(file, `# My Agent\n`, "utf8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await main(["agent", "parse", "**/*.agent.md", "--stdout"]);
      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);

      const line = String(logSpy.mock.calls[0]?.[0] ?? "");
      const parsed = JSON.parse(line) as { file: string; definition: { title: string } };
      expect(parsed.file).toBe("one.agent.md");
      expect(parsed.definition.title).toBe("My Agent");
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("returns exit code 2 when no files match", async () => {
    const dir = await makeTempDir();

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await main(["agent", "parse", "**/*.agent.md"]);
      expect(code).toBe(2);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      const msg = String(errSpy.mock.calls[0]?.[0] ?? "");
      expect(msg).toMatch(/No '\*\.agent\.md' files found/);
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

