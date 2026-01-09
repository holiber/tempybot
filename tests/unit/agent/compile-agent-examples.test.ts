import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAgentMd } from "../../../src/agent/parse-agent-md.js";
import type { AgentDefinition } from "../../../src/agent/types.js";

type StableJson = null | boolean | number | string | StableJson[] | { [k: string]: StableJson };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toStableJson(v: unknown): StableJson {
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => toStableJson(x));
  if (isPlainObject(v)) {
    const out: Record<string, StableJson> = {};
    for (const k of Object.keys(v).sort((a, b) => a.localeCompare(b))) {
      out[k] = toStableJson(v[k]);
    }
    return out;
  }
  // AgentDefinition should be fully JSON-serializable; fail fast if not.
  throw new Error(`Non-JSON value encountered while serializing: ${String(v)}`);
}

function stableStringifyJson(v: unknown): string {
  return JSON.stringify(toStableJson(v), null, 2) + "\n";
}

function baseNameNoExt(fileName: string): string {
  return fileName.replace(/\.agent\.md$/i, "");
}

const EXPECTED_AGENT_DEFINITION_KEYS = [
  "commands",
  "description",
  "icon",
  "input",
  "recommended",
  "required",
  "rules",
  "status",
  "system",
  "templateEngine",
  "title",
  "toolsSource",
  "version",
].sort();

describe("agent examples compile (docs/agent-examples -> docs/generated/agent-examples)", () => {
  it("compiles 10 example agents to deterministic JSON (and writes manifest/report)", async () => {
    const ROOT = process.cwd();
    const examplesDir = path.join(ROOT, "docs", "agent-examples");
    const outDir = path.join(ROOT, "docs", "generated", "agent-examples");

    const entries = await fs.readdir(examplesDir);
    const mdFiles = entries.filter((f) => f.endsWith(".agent.md")).sort((a, b) => a.localeCompare(b));
    expect(mdFiles).toHaveLength(10);

    await fs.mkdir(outDir, { recursive: true });

    const manifest: Array<{ source: string; output: string; title: string; status: string }> = [];
    const reportLines: string[] = [
      "# Agent examples compilation report",
      "",
      "This folder is generated from `docs/agent-examples/*.agent.md` using the repository parser `parseAgentMd`.",
      "",
      "## Summary",
      "",
      `- Source files: ${mdFiles.length}`,
      `- Output files: ${mdFiles.length} JSON + manifest + report`,
      "",
      "## Data preservation notes",
      "",
      "- Each compiled JSON file contains the full `AgentDefinition` shape (all expected keys are asserted in tests).",
      "- The parser preserves `recommended` and `required` objects (including extra keys inside those objects).",
      "- Content outside the supported surface (e.g. additional headings/sections, unknown top-level frontmatter keys) is not represented in `AgentDefinition` and will not appear in the compiled JSON.",
      "",
      "## Per-file overview",
      "",
      "| Source | Title | Status | Commands | System chars | Rules chars | Tools chars |",
      "|--------|-------|--------|----------|--------------|------------|------------|",
    ];

    for (const mdFile of mdFiles) {
      const sourcePath = path.join(examplesDir, mdFile);
      const parsed = await parseAgentMd(sourcePath);

      // Guardrail: ensure compiled JSON is a full AgentDefinition (no missing keys).
      const parsedKeys = Object.keys(parsed).sort();
      expect(parsedKeys).toEqual(EXPECTED_AGENT_DEFINITION_KEYS);

      const outFile = `${baseNameNoExt(mdFile)}.json`;
      const outPath = path.join(outDir, outFile);
      const json = stableStringifyJson(parsed satisfies AgentDefinition);

      // "Creates a .json file for each" (idempotent overwrite).
      await fs.writeFile(outPath, json, "utf8");

      // Determinism check: written content should parse back to the same structure.
      const roundtrip = JSON.parse(await fs.readFile(outPath, "utf8")) as AgentDefinition;
      expect(roundtrip).toEqual(parsed);

      manifest.push({
        source: `docs/agent-examples/${mdFile}`,
        output: `docs/generated/agent-examples/${outFile}`,
        title: parsed.title,
        status: parsed.status,
      });

      reportLines.push(
        `| ${mdFile} | ${parsed.title.replace(/\|/g, "\\|")} | ${parsed.status} | ${parsed.commands.length} | ${parsed.system.length} | ${parsed.rules.length} | ${parsed.toolsSource.length} |`,
      );
    }

    manifest.sort((a, b) => a.source.localeCompare(b.source));
    await fs.writeFile(path.join(outDir, "manifest.json"), stableStringifyJson(manifest), "utf8");
    await fs.writeFile(path.join(outDir, "report.md"), reportLines.join("\n") + "\n", "utf8");
  });
});

