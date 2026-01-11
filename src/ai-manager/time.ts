import { setTimeout as sleep } from "node:timers/promises";

export async function sleepMs(ms: number): Promise<void> {
  await sleep(Math.max(0, ms));
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label = "timeout"): Promise<T> {
  const t = Math.max(1, ms);
  return await Promise.race([
    p,
    (async () => {
      await sleepMs(t);
      throw new Error(`${label}_after_${t}ms`);
    })(),
  ]);
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts?: { tries?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<T> {
  const tries = Math.max(1, opts?.tries ?? 3);
  const base = Math.max(0, opts?.baseDelayMs ?? 200);
  const max = Math.max(base, opts?.maxDelayMs ?? 5_000);
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const delay = Math.min(max, base * 2 ** i);
      if (i < tries - 1) await sleepMs(delay);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

