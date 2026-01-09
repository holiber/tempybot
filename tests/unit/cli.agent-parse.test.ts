import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../../src/cli.js";

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "tempybot-cli-"));
}

describe("cli: tempybot parse", () => {
  it("prints formatted JSON to stdout", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "one.agent.md");
    await fs.writeFile(file, `# My Agent\n`, "utf8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await main(["parse", file]);
      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);

      const printed = String(logSpy.mock.calls[0]?.[0] ?? "");
      const parsed = JSON.parse(printed) as { title: string };
      expect(parsed.title).toBe("My Agent");
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("writes JSON to --out and still prints to stdout", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "one.agent.md");
    const out = path.join(dir, "out", "one.agent.json");
    await fs.writeFile(file, `# My Agent\n`, "utf8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await main(["parse", file, "--out", out]);
      expect(code).toBe(0);
      expect(errSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledTimes(1);

      const printed = String(logSpy.mock.calls[0]?.[0] ?? "");
      const parsed = JSON.parse(printed) as { title: string };
      expect(parsed.title).toBe("My Agent");

      const written = await fs.readFile(out, "utf8");
      const writtenParsed = JSON.parse(written) as { title: string };
      expect(writtenParsed.title).toBe("My Agent");
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("returns exit code 2 when input path is missing", async () => {
    const dir = await makeTempDir();

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await main(["parse"]);
      expect(code).toBe(2);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      const msg = String(errSpy.mock.calls[0]?.[0] ?? "");
      expect(msg).toMatch(/Missing input file path/);
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });

  it("returns exit code 1 and prints reason to stderr when parsing fails", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "bad.agent.md");
    await fs.writeFile(file, ``, "utf8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const code = await main(["parse", file]);
      expect(code).toBe(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalled();
      const msg = String(errSpy.mock.calls[0]?.[0] ?? "");
      expect(msg).toMatch(/Missing title/);
    } finally {
      cwdSpy.mockRestore();
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

