import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CursorCloudTool } from "../../../src/ai-manager/cursor-cloud-tool.ts";
import { runOpenAiTurn } from "../../../src/ai-manager/openai-driver.ts";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function readOpenAiKey(): string | undefined {
  return readEnv("OPENAI_KEY") ?? readEnv("OPENAI_API_KEY");
}

function readCursorKey(): string | undefined {
  return readEnv("CURSORCLOUDAPIKEY") ?? readEnv("CURSOR_API_KEY") ?? readEnv("CURSOR_CLOUD_API_KEY");
}

function model(): string {
  return readEnv("OPENAI_MODEL") ?? "gpt-4o-mini";
}

describe("ai-manager live integrations (OpenAI + Cursor Cloud)", () => {
  const openaiKey = readOpenAiKey();
  const cursorKey = readCursorKey();

  const itOpenAi = openaiKey ? it : it.skip;
  const itCursor = cursorKey ? it : it.skip;
  const itBoth = openaiKey && cursorKey ? it : it.skip;

  itOpenAi(
    "agent responds to a single prompt",
    async () => {
      const res = await runOpenAiTurn({
        model: model(),
        messages: [{ role: "user", content: "Reply with exactly: PONG (uppercase). No punctuation, no extra words." }],
        timeoutMs: 30_000,
      });
      expect(res.text.trim()).toMatch(/^PONG$/);
    },
    60_000
  );

  itOpenAi(
    "agent has a little conversation (keeps short context)",
    async () => {
      const turn1 = await runOpenAiTurn({
        model: model(),
        messages: [{ role: "user", content: "Reply with exactly: ALPHA BETA" }],
        timeoutMs: 30_000,
      });
      expect(turn1.text.trim()).toMatch(/^ALPHA BETA$/);

      const turn2 = await runOpenAiTurn({
        model: model(),
        messages: [
          { role: "user", content: "Reply with exactly: ALPHA BETA" },
          { role: "assistant", content: turn1.text },
          { role: "user", content: "What is the first word of your previous reply? Reply with exactly that word." },
        ],
        timeoutMs: 30_000,
      });
      expect(turn2.text.trim()).toMatch(/^ALPHA$/);
    },
    90_000
  );

  itOpenAi(
    "agent uses a tool (function call)",
    async () => {
      const res = await runOpenAiTurn({
        model: model(),
        messages: [
          {
            role: "user",
            content:
              "You must call the add tool with a=2 and b=3. After the tool returns, reply with exactly the number result.",
          },
        ],
        tools: [
          {
            name: "add",
            description: "Add two integers and return {result}.",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["a", "b"],
              properties: { a: { type: "integer" }, b: { type: "integer" } },
            },
            handler: (args: any) => ({ result: Number(args?.a) + Number(args?.b) }),
          },
        ],
        toolChoice: { type: "function", name: "add" },
        timeoutMs: 30_000,
      });

      expect(res.toolCalls.some((c) => c.name === "add")).toBe(true);
      const call = res.toolCalls.find((c) => c.name === "add");
      const a = Number((call as any)?.arguments?.a);
      const b = Number((call as any)?.arguments?.b);
      expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true);
      const expected = a + b;
      expect(Number(res.text.trim())).toBe(expected);
    },
    90_000
  );

  itOpenAi(
    "agent uses fs (via tool) to read a file",
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-manager-fs-"));
      const p = path.join(dir, "hello.txt");
      await fs.writeFile(p, "FILE_OK", "utf8");

      const res = await runOpenAiTurn({
        model: model(),
        messages: [
          {
            role: "user",
            content: `Use read_file to read the file at path "${p}". Reply with exactly the file contents.`,
          },
        ],
        tools: [
          {
            name: "read_file",
            description: "Read a UTF-8 text file from disk. args: { path }",
            parameters: {
              type: "object",
              additionalProperties: false,
              required: ["path"],
              properties: { path: { type: "string" } },
            },
            handler: async (args: any) => {
              const fp = String(args?.path ?? "");
              return await fs.readFile(fp, "utf8");
            },
          },
        ],
        toolChoice: { type: "function", name: "read_file" },
        timeoutMs: 30_000,
      });

      expect(res.toolCalls.some((c) => c.name === "read_file")).toBe(true);
      expect(res.text.trim()).toBe("FILE_OK");
    },
    90_000
  );

  itBoth(
    "agent makes a request to Cursor Cloud (via tool)",
    async () => {
      const tool = new CursorCloudTool({ apiKey: cursorKey! });
      const res = await runOpenAiTurn({
        model: model(),
        messages: [
          {
            role: "user",
            content:
              "Call cursor_list_agents, then reply with exactly: agents:<count> where <count> is the number returned by the tool.",
          },
        ],
        tools: [
          {
            name: "cursor_list_agents",
            description: "List Cursor Cloud agents and return {count}.",
            parameters: { type: "object", additionalProperties: false, properties: {} },
            handler: async () => {
              const r = await tool.listAgents(5);
              if (!r.ok) return { ok: false, code: r.code, message: r.message };
              return { count: r.data.agents.length };
            },
          },
        ],
        toolChoice: { type: "function", name: "cursor_list_agents" },
        timeoutMs: 30_000,
      });

      expect(res.toolCalls.some((c) => c.name === "cursor_list_agents")).toBe(true);
      expect(res.text.trim()).toMatch(/^agents:\d+$/);
    },
    120_000
  );

  itCursor(
    "Cursor Cloud request works without OpenAI (sanity)",
    async () => {
      const tool = new CursorCloudTool({ apiKey: cursorKey! });
      const res = await tool.listAgents(5);
      expect(res.ok, res.ok ? "" : res.message).toBe(true);
      if (res.ok) expect(Array.isArray(res.data.agents)).toBe(true);
    },
    30_000
  );
});

