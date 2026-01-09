import { describe, expect, it } from "vitest";
import { hello } from "../../../src/hello";

/**
 * Integration tests are opt-in and may require secrets in real projects.
 * This repo keeps a tiny "hello world" integration test as a template.
 */
describe("hello() (integration)", () => {
  it("still works in integration suite", () => {
    expect(hello()).toBe("Hello, world!");
  });
});

