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
    expect(parsed.toolsSource).toContain("init");
  });

  it("throws on conflicting title between YAML frontmatter and H1 title", () => {
    const raw = `---
title: From YAML
---

# From Heading
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/Conflicting 'title'/);
  });

  it("throws on conflicting description between YAML frontmatter and first paragraph fallback", () => {
    const raw = `---
description: From YAML
---

# Title
From Heading
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/Conflicting 'description'/);
  });

  it("throws on conflicting system between YAML frontmatter and ## System section", () => {
    const raw = `---
system: From YAML
---

# Title

## System
From Heading
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/Conflicting 'system'/);
  });

  it("throws on conflicting rules between YAML frontmatter and ## Rules section", () => {
    const raw = `---
rules: From YAML
---

# Title

## Rules
From Heading
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/Conflicting 'rules'/);
  });

  it("throws on invalid status (instead of defaulting)", () => {
    const raw = `---
status: nope
---

# Title
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/Invalid frontmatter 'status'/);
  });

  it("throws on malformed commands (non-array)", () => {
    const raw = `---
commands: hello
---

# Title
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/Invalid frontmatter 'commands': expected an array/);
  });

  it("throws on empty commands array", () => {
    const raw = `---
commands: []
---

# Title
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/must not be an empty array/);
  });

  it("throws on malformed inline command objects", () => {
    const raw = `---
commands:
  - name: test
    description: ""
    body: echo hi
---

# Title
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/commands\[0\]\.description/);
  });

  it("accepts http(s) command URLs and local path command refs", () => {
    const raw = `---
commands:
  - ./commands
  - https://example.com/commands/test.md
---

# Title
`;
    const parsed = parseAgentMdFromString(raw);
    expect(parsed.commands).toEqual(["./commands", "https://example.com/commands/test.md"]);
  });

  it("throws on command string refs that are neither a local path nor a URL", () => {
    const raw = `---
commands:
  - test
---

# Title
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/commands\[0\].*local path.*URL/i);
  });

  it("validates required.startup references a tool in ## Tools (case-insensitive, return object literal)", () => {
    const raw = `---
required:
  startup: Ping
---

# Title

## Tools
return {
  ping: {
    fn: () => "pong",
    scheme: { name: "ping", description: "Ping", parameters: { type: "object", properties: {} } },
  },
};
`;
    const parsed = parseAgentMdFromString(raw);
    expect(parsed.required).toEqual({ startup: "Ping" });
  });

  it("validates required.startup references a tool in ## Tools (return identifier)", () => {
    const raw = `---
required:
  startup: init
---

# Title

## Tools
const tools = {
  init: { fn: () => true, scheme: { name: "init", description: "Init", parameters: { type: "object" } } },
};
return tools;
`;
    const parsed = parseAgentMdFromString(raw);
    expect(parsed.required).toEqual({ startup: "init" });
  });

  it("throws when required.startup is set but no tools are declared", () => {
    const raw = `---
required:
  startup: init
---

# Title
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/required\.startup.*no tools were found/i);
  });

  it("throws when required.startup does not match any declared tool", () => {
    const raw = `---
required:
  startup: nope
---

# Title

## Tools
return { ping: { fn: () => "pong", scheme: { name: "ping", description: "Ping", parameters: { type: "object" } } } };
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/required\.startup.*does not match/i);
  });

  it("throws on invalid type for known scalar fields", () => {
    const raw = `---
title: 123
---

# Title
`;
    expect(() => parseAgentMdFromString(raw)).toThrow(/Invalid frontmatter 'title': expected a string/);
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

