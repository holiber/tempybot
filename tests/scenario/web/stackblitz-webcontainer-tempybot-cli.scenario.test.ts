import { test } from "vitest";
import { spawnSync } from "node:child_process";
import { startWebSession, userSleep } from "../test-utils.js";

function currentGitBranchName(): string | null {
  const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  if ((r.status ?? 1) !== 0) return null;
  const v = String(r.stdout ?? "").trim();
  if (!v || v === "HEAD") return null;
  return v;
}

function stackblitzUrl(opts: { repo: string; ref: string; path: string }): string {
  // StackBlitz uses GitHub-like URLs; encoding the ref helps with branch names containing slashes.
  return `https://stackblitz.com/github/${opts.repo}/tree/${encodeURIComponent(opts.ref)}/${opts.path}`;
}

async function maybeAcceptConsent(page: any): Promise<void> {
  const candidates = [
    page.getByRole?.("button", { name: /accept/i }),
    page.getByRole?.("button", { name: /agree/i }),
    page.getByRole?.("button", { name: /got it/i }),
  ].filter(Boolean);

  for (const btn of candidates) {
    try {
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        return;
      }
    } catch {
      // ignore
    }
  }
}

test(
  "webcontainers (stackblitz): run tempybot CLI parse and capture output",
  { timeout: 240_000 },
  async () => {
    const web = await startWebSession();
    try {
      const repo = process.env.GITHUB_REPOSITORY ?? "holiber/tempybot";
      const ref = process.env.GITHUB_REF_NAME ?? currentGitBranchName() ?? "main";
      const url = stackblitzUrl({ repo, ref, path: "demos/stackblitz-webcontainer/tempybot-cli" });

      await web.page.goto(url, { waitUntil: "domcontentloaded" });
      await maybeAcceptConsent(web.page);

      // Our demo prints this marker after running: `tsx src/cli.ts parse ./sample.agent.md`
      await web.page.getByText("STACKBLITZ_TEMPYBOT_CLI_OK").waitFor({ timeout: 200_000 });

      await userSleep(2500);
    } finally {
      await web.close();
      await userSleep();
    }
  }
);

