import { describe, expect, it } from "vitest";
import { InMemoryChat } from "../../../../src/stc/light/index.js";

describe("stc/light Chat", () => {
  it("appends messages with monotonic seq and fetches newest-first", async () => {
    const chat = new InMemoryChat({
      descriptor: { id: "c1", title: "t", limits: { maxMessages: 100 } }
    });

    const m1 = await chat.append({ role: "user", body: "one" });
    const m2 = await chat.append({ role: "user", body: "two" });

    expect(m2.seq).toBeGreaterThan(m1.seq);

    const r = await chat.fetchMessages({ limit: 2 });
    expect(r.messages.map((m) => m.body)).toEqual(["two", "one"]);
  });

  it("supports before-cursor pagination", async () => {
    const chat = new InMemoryChat({ descriptor: { id: "c2" } });
    const msgs = [];
    for (let i = 0; i < 5; i += 1) msgs.push(await chat.append({ role: "user", body: `m${i}` }));

    const page1 = await chat.fetchMessages({ limit: 2 });
    expect(page1.messages.map((m) => m.body)).toEqual(["m4", "m3"]);
    expect(page1.page?.hasMore).toBe(true);

    const page2 = await chat.fetchMessages({ limit: 10, before: page1.page!.next! });
    expect(page2.messages.map((m) => m.body)).toEqual(["m2", "m1", "m0"]);
  });
});

