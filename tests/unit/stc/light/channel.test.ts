import { describe, expect, it } from "vitest";
import { ChannelFactory } from "../../../../src/stc/light/index.js";

describe("stc/light Channel", () => {
  it("enforces canRead=false on subscribe", () => {
    const ch = new ChannelFactory().create<string>({ caps: { canRead: false } });
    expect(() => ch.subscribe(() => {})).toThrow(/not readable/i);
  });

  it("enforces canWrite=false on send", () => {
    const ch = new ChannelFactory().create<string>({ caps: { canWrite: false } });
    expect(() => ch.send("x")).toThrow(/not writable/i);
  });

  it("unsubscribes via AbortSignal", () => {
    const ch = new ChannelFactory().create<string>();
    const ac = new AbortController();

    const events: string[] = [];
    ch.subscribe((e) => e.kind === "data" && events.push(e.data), { signal: ac.signal });

    ch.send("a");
    ac.abort();
    ch.send("b");

    expect(events).toEqual(["a"]);
  });

  it("close is idempotent and clears subscriptions", () => {
    const ch = new ChannelFactory().create<string>();
    const events: string[] = [];
    ch.subscribe((e) => e.kind === "data" && events.push(e.data));

    ch.close();
    ch.close();
    ch.send("x");

    expect(events).toEqual([]);
  });
});

