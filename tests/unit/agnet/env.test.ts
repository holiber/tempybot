import { describe, expect, it } from "vitest";

import { getCursorApiKeyFromEnv, getOpenAiApiKeyFromEnv } from "../../../src/agnet/env.ts";

describe("agnet/env env var resolution", () => {
  it("resolves Cursor key from CURSOR_API_KEY first", () => {
    const v = getCursorApiKeyFromEnv({
      CURSOR_API_KEY: " a ",
      CURSOR_CLOUD_API_KEY: " b ",
      CURSORCLOUDAPIKEY: " c ",
    });
    expect(v).toBe("a");
  });

  it("resolves Cursor key from CURSOR_CLOUD_API_KEY if CURSOR_API_KEY missing", () => {
    const v = getCursorApiKeyFromEnv({
      CURSOR_CLOUD_API_KEY: "  key1  ",
    });
    expect(v).toBe("key1");
  });

  it("resolves Cursor key from CURSORCLOUDAPIKEY if others missing", () => {
    const v = getCursorApiKeyFromEnv({
      CURSORCLOUDAPIKEY: "\nkey2\t",
    });
    expect(v).toBe("key2");
  });

  it("resolves OpenAI key from OPENAI_API_KEY first", () => {
    const v = getOpenAiApiKeyFromEnv({
      OPENAI_API_KEY: " a ",
      OPENAI_KEY: " b ",
    });
    expect(v).toBe("a");
  });

  it("resolves OpenAI key from OPENAI_KEY if OPENAI_API_KEY missing", () => {
    const v = getOpenAiApiKeyFromEnv({
      OPENAI_KEY: "  k  ",
    });
    expect(v).toBe("k");
  });

  it("returns undefined if no supported keys are set", () => {
    expect(getCursorApiKeyFromEnv({})).toBeUndefined();
    expect(getOpenAiApiKeyFromEnv({})).toBeUndefined();
  });
});

