import * as pty from "node-pty";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";

/**
 * SCENARIO_MODE:
 * - "smoke"    -> no delays, fastest possible execution
 * - "userlike" -> real pauses and typing delays (human-like)
 */
export type ScenarioMode = "smoke" | "userlike";

export const SCENARIO_MODE: ScenarioMode =
  process.env.SCENARIO_MODE === "smoke" ? "smoke" : "userlike";

/**
 * SCENARIO_WEB_DEVICE:
 * - "desktop" (default)
 * - "mobile"
 */
export type WebDeviceMode = "desktop" | "mobile";

export const SCENARIO_WEB_DEVICE: WebDeviceMode =
  process.env.SCENARIO_WEB_DEVICE === "mobile" ? "mobile" : "desktop";

export async function userSleep(ms = 1500): Promise<void> {
  if (SCENARIO_MODE === "smoke") return;
  await new Promise((r) => setTimeout(r, ms));
}

export async function userTypeDelay(ms = 40): Promise<void> {
  await userSleep(ms);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * CliSession
 *
 * Runs a CLI inside a pseudo-terminal (PTY) so it behaves like a real terminal.
 * Useful for user-like scenario tests and reliable output capturing.
 */
export class CliSession {
  private term: pty.IPty;
  private buffer = "";
  private exitInfo: { exitCode: number; signal: number } | null = null;
  private exitPromise: Promise<{ exitCode: number; signal: number }>;

  constructor(cmd: string, args: string[], cwd: string) {
    this.term = pty.spawn(cmd, args, {
      cwd,
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      env: { ...process.env, FORCE_COLOR: "1" },
    });

    this.exitPromise = new Promise((resolve) => {
      this.term.onExit((e) => {
        this.exitInfo = { exitCode: e.exitCode, signal: e.signal };
        resolve(this.exitInfo);
      });
    });

    this.term.onData((data) => {
      this.buffer += data;
    });
  }

  output(): string {
    return this.buffer;
  }

  write(text: string): void {
    this.term.write(text);
  }

  kill(): void {
    this.term.kill();
  }

  async waitForExit(timeoutMs = 20_000): Promise<{ exitCode: number; signal: number }> {
    if (this.exitInfo) return this.exitInfo;

    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout waiting for process exit.\n\nCLI output so far:\n${this.buffer}`));
      }, timeoutMs);
    });

    return await Promise.race([this.exitPromise, timeout]);
  }

  async typeCharByChar(text: string, onEachChar?: () => Promise<void>): Promise<void> {
    for (const ch of text) {
      this.term.write(ch);
      if (onEachChar) await onEachChar();
    }
  }

  async waitFor(pattern: RegExp | string, timeoutMs = 20_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const content = this.buffer;
      const matched =
        typeof pattern === "string" ? content.includes(pattern) : pattern.test(content);
      if (matched) return;
      await sleep(50);
    }

    throw new Error(`Timeout waiting for: ${String(pattern)}\n\nCLI output so far:\n${this.buffer}`);
  }
}

export type WebSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close: () => Promise<void>;
};

export async function startWebSession(): Promise<WebSession> {
  const browser = await chromium.launch({ headless: true });

  let context: BrowserContext;
  const recordVideoDir =
    SCENARIO_MODE === "userlike" ? process.env.E2E_WEB_VIDEO_DIR : undefined;

  if (SCENARIO_WEB_DEVICE === "mobile") {
    const device = devices["iPhone 14"];
    context = await browser.newContext({
      ...device,
      recordVideo: recordVideoDir ? { dir: recordVideoDir } : undefined,
    });
  } else {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: recordVideoDir ? { dir: recordVideoDir } : undefined,
    });
  }

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    close: async () => {
      // Video is finalized when the context is closed.
      await context.close();
      await browser.close();
    },
  };
}

export async function userType(
  page: Page,
  selector: string,
  text: string,
  perCharDelayMs = 40
): Promise<void> {
  if (SCENARIO_MODE === "smoke") {
    await page.fill(selector, text);
    return;
  }

  await page.click(selector);
  await page.fill(selector, "");
  await page.type(selector, text, { delay: perCharDelayMs });
}

