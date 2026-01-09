import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAgentMd, parseAgentMdFromString } from "../../../src/agent/parse-agent-md";

describe("parseAgentMdFromString()", () => {
  it("applies defaults and extracts core sections without frontmatter", async () => {
    const raw = await fs.readFile(new URL("./fixtures/minimal.agent.md", import.meta.url), "utf8");
    const parsed = parseAgentMdFromString(raw);

    expect(parsed).toMatchObject({
      version: "0.1.0",
      icon: "🤖",
      status: "active",
      templateEngine: "hbs",
      input: "",
      recommended: {},
      required: {},
      commands: [],
      title: "My Agent",
      description: "This is a test agent.",
      system: "You are a helpful assistant.",
      rules: "- Be concise\n- Be correct",
    });

    expect(parsed.toolsSource).toContain("const tools");
    expect(parsed.toolsSource).toContain("return tools;");
  });

  it("parses YAML frontmatter case-insensitively and prefers it over fallbacks", async () => {
    const raw = await fs.readFile(new URL("./fixtures/frontmatter-case.agent.md", import.meta.url), "utf8");
    const parsed = parseAgentMdFromString(raw);

    expect(parsed.version).toBe("9.9.9");
    expect(parsed.icon).toBe("🧪");
    expect(parsed.title).toBe("From YAML");
    expect(parsed.description).toBe("YAML description.");
    expect(parsed.status).toBe("deprecated");
    expect(parsed.templateEngine).toBe("");
    expect(parsed.input).toBe("hello");

    expect(parsed.recommended).toEqual({
      models: ["gpt-4o"],
      capabilities: ["fs"],
    });
    expect(parsed.required).toEqual({
      env: ["API_KEY"],
      startup: "init",
    });
    expect(parsed.commands).toEqual([
      "./commands",
      {
        name: "test",
        description: "Test command",
        body: "echo hi\n",
      },
    ]);

    expect(parsed.system).toBe("System from section.");
    expect(parsed.rules).toBe("");
    expect(parsed.toolsSource).toBe("");
  });
});

describe("parseAgentMd()", () => {
  it("reads and parses from a file path", async () => {
    const filePath = fileURLToPath(new URL("./fixtures/minimal.agent.md", import.meta.url));
    const parsed = await parseAgentMd(filePath);

    expect(parsed.title).toBe("My Agent");
    expect(parsed.system).toBe("You are a helpful assistant.");
  });
});

