import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runBigBoss(env: Record<string, string | undefined>): { code: number; stdout: string; stderr: string } {
  const script = path.join(process.cwd(), ".github", "workflows", "bigboss", "run.sh");
  const r = spawnSync("bash", [script], {
    cwd: process.cwd(),
    env: { ...process.env, FORCE_COLOR: "0", ...env },
    encoding: "utf8",
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("bigboss/run.sh env mapping + redaction (dry run)", () => {
  it("maps CURSORCLOUDAPIKEY -> CURSOR_API_KEY and OPENAI_KEY -> OPENAI_API_KEY without leaking values", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bigboss-env-"));
    const eventPath = path.join(tmpDir, "event.json");
    fs.writeFileSync(eventPath, JSON.stringify({ inputs: { prompt: "" } }), "utf8");

    const cursorSecret = "key_deadbeef_deadbeef";
    const openaiSecret = "sk-proj-TEST-DO-NOT-LEAK";

    const res = runBigBoss({
      BIGBOSS_DRY_RUN: "1",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_EVENT_PATH: eventPath,
      GH_TOKEN: "ghp_dummy",
      CURSORCLOUDAPIKEY: cursorSecret,
      OPENAI_KEY: openaiSecret,
    });

    expect(res.code).toBe(0);
    expect(res.stdout).toContain("CURSOR_API_KEY set   : yes");
    expect(res.stdout).toContain("OPENAI_API_KEY set   : yes");
    expect(res.stdout).toContain("BIGBOSS_DRY_RUN=1: exiting");

    // Ensure secrets are not printed anywhere.
    expect(res.stdout).not.toContain(cursorSecret);
    expect(res.stdout).not.toContain(openaiSecret);
    expect(res.stderr).not.toContain(cursorSecret);
    expect(res.stderr).not.toContain(openaiSecret);
  });
});

