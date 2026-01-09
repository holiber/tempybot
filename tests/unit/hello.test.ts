import { describe, expect, it } from "vitest";
import { hello } from "../../src/hello.js";

describe("hello()", () => {
  it("greets world by default", () => {
    expect(hello()).toBe("Hello, world!");
  });

  it("greets a provided name", () => {
    expect(hello("Cursor")).toBe("Hello, Cursor!");
  });
});

