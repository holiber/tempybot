import * as pty from "node-pty";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
import { performance } from "node:perf_hooks";

/**
 * SCENARIO_MODE:
 * - "smoke"    -> no delays, fastest possible execution
 * - "userlike" -> real pauses and typing delays (human-like)
 */
export type ScenarioMode = "smoke" | "userlike";

export const SCENARIO_MODE: ScenarioMode =
  process.env.SCENARIO_MODE === "smoke" ? "smoke" : "userlike";

type UserSleepSample = {
  requestedMs: number;
  actualMs: number;
};

type ScenarioTimingsStore = {
  userSleepSamples: UserSleepSample[];
  registered: boolean;
  printed: boolean;
};

const TIMINGS_SYM = Symbol.for("stc.scenario.timings");
const timingsStore: ScenarioTimingsStore =
  ((globalThis as unknown as Record<symbol, ScenarioTimingsStore>)[TIMINGS_SYM] ??=
    { userSleepSamples: [], registered: false, printed: false });

function isScenarioTimingsEnabled(): boolean {
  return process.env.SCENARIO_TIMINGS === "1";
}

function registerScenarioTimingsSummary(): void {
  if (SCENARIO_MODE !== "userlike") return;
  if (!isScenarioTimingsEnabled()) return;
  if (timingsStore.registered) return;
  timingsStore.registered = true;

  process.once("beforeExit", () => {
    if (timingsStore.printed) return;
    timingsStore.printed = true;

    const samples = timingsStore.userSleepSamples;
    if (!samples.length) {
      // Keep this stable for log scraping.
      // eslint-disable-next-line no-console
      console.log("SCENARIO_TIMINGS userSleep calls=0");
      return;
    }

    const actuals = samples.map((s) => s.actualMs);
    const requested = samples.map((s) => s.requestedMs);

    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const min = (xs: number[]) => Math.min(...xs);
    const max = (xs: number[]) => Math.max(...xs);
    const avg = (xs: number[]) => sum(xs) / xs.length;

    const reqSum = sum(requested);
    const actSum = sum(actuals);
    const drift = actSum - reqSum;

    // eslint-disable-next-line no-console
    console.log(
      [
        "SCENARIO_TIMINGS",
        `userSleep calls=${samples.length}`,
        `requested_ms_total=${reqSum.toFixed(0)}`,
        `actual_ms_total=${actSum.toFixed(0)}`,
        `drift_ms_total=${drift.toFixed(0)}`,
        `actual_ms_min=${min(actuals).toFixed(1)}`,
        `actual_ms_avg=${avg(actuals).toFixed(1)}`,
        `actual_ms_max=${max(actuals).toFixed(1)}`,
      ].join(" ")
    );
  });
}

/**
 * SCENARIO_WEB_DEVICE:
 * - "desktop" (default)
 * - "mobile"
 */
export type WebDeviceMode = "desktop" | "mobile";

export const SCENARIO_WEB_DEVICE: WebDeviceMode =
  process.env.SCENARIO_WEB_DEVICE === "mobile" ? "mobile" : "desktop";

export async function userSleep(ms = 800): Promise<void> {
  if (SCENARIO_MODE === "smoke") return;
  registerScenarioTimingsSummary();
  const started = performance.now();
  await new Promise((r) => setTimeout(r, ms));
  const actualMs = performance.now() - started;
  if (isScenarioTimingsEnabled()) {
    timingsStore.userSleepSamples.push({ requestedMs: ms, actualMs });
  }
}

export async function userTypeDelay(ms = 90): Promise<void> {
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

  constructor(cmd: string, args: string[], cwd: string) {
    this.term = pty.spawn(cmd, args, {
      cwd,
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      env: { ...process.env, FORCE_COLOR: "1" },
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

