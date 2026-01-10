import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

type RunResult = { code: number; stdout: string; stderr: string };

function runAgnet(args: string[], env?: Record<string, string | undefined>): RunResult {
  const script = path.join(process.cwd(), "scripts", "agnet.ts");
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0", ...(env ?? {}) },
    encoding: "utf8",
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function combinedOutput(r: RunResult): string {
  return `stdout:\n${r.stdout}\n\nstderr:\n${r.stderr}\n`;
}

function parseJsonStdout<T>(r: RunResult): T {
  const raw = r.stdout.trim();
  if (!raw) throw new Error(`Expected JSON on stdout.\n\n${combinedOutput(r)}`);
  return JSON.parse(raw) as T;
}

function isCi(): boolean {
  return process.env.CI === "1" || process.env.CI === "true";
}

function isCursorInstalled(): boolean {
  // Best-effort probe.
  const r = spawnSync("agent", ["--version"], { encoding: "utf8" });
  return (r.status ?? 1) === 0;
}

describe("agnet.ts selfcheck (integration)", () => {
  it("runs and reports MCP + GitHub checks (and Cursor CLI on CI)", () => {
    const env: Record<string, string | undefined> = {
      AGNET_SELF_CHECK_REQUIRE_GITHUB: "1",
      // Only require cursor CLI when running on CI (the workflow installs it).
      ...(isCi() ? { AGNET_SELF_CHECK_REQUIRE_CURSOR_CLI: "1" } : {}),
      // Never require Cursor API for public CI: it depends on secrets.
      AGNET_SELF_CHECK_REQUIRE_CURSOR_API: "0",
      // Ensure GH CLI uses Actions token when present.
      GH_TOKEN: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
    };

    const res = runAgnet(["--json", "selfcheck"], env);
    expect(res.code, combinedOutput(res)).toBe(0);

    const json = parseJsonStdout<{
      ok: boolean;
      command: "selfcheck";
      checks: Array<{ name: string; ok: boolean; required: boolean; skipped?: boolean; error?: { message: string } }>;
    }>(res);

    expect(json.ok).toBe(true);
    expect(json.command).toBe("selfcheck");

    const byName = new Map(json.checks.map((c) => [c.name, c]));
    expect(byName.get("mcp.openapi.schema")?.ok).toBe(true);
    expect(byName.get("github.gh")?.ok).toBe(true);

    // Locally, cursor CLI may not be installed; it should be either ok (installed) or skipped (not required).
    const cursor = byName.get("cursor.cli");
    expect(cursor).toBeTruthy();
    if (isCi() || isCursorInstalled()) {
      expect(cursor?.ok, combinedOutput(res)).toBe(true);
    } else {
      expect(cursor?.ok).toBe(false);
      expect(cursor?.skipped).toBe(true);
    }

    // Cursor API check should never be required in this test.
    const cursorApi = byName.get("cursor.api.models");
    expect(cursorApi).toBeTruthy();
    expect(cursorApi?.required).toBe(false);
  });
});

