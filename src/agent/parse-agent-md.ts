import fs from "node:fs/promises";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import { toString } from "mdast-util-to-string";
import YAML from "yaml";
import type { Root, Content, Heading, Paragraph } from "mdast";
import type { AgentCommand, AgentDefinition, AgentStatus } from "./types";
import { AGENT_DEFINITION_DEFAULTS } from "./types";

type Frontmatter = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function lowercaseKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => lowercaseKeysDeep(x));
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v)) {
    out[k.toLowerCase()] = lowercaseKeysDeep(value);
  }
  return out;
}

function getString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  return undefined;
}

function getStatus(v: unknown): AgentStatus | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase().trim();
  if (s === "active" || s === "deprecated" || s === "disabled") return s;
  return undefined;
}

function getCommands(v: unknown): AgentCommand[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v as AgentCommand[];
}

type SectionName = "system" | "rules" | "tools";

function normalizeHeadingText(s: string): string {
  return s.trim().toLowerCase();
}

function isHeading(node: Content): node is Heading {
  return node.type === "heading";
}

function isParagraph(node: Content): node is Paragraph {
  return node.type === "paragraph";
}

function advanceToNextLine(md: string, offset: number): number {
  if (offset < 0) return 0;
  if (offset >= md.length) return md.length;
  const idx = md.indexOf("\n", offset);
  return idx === -1 ? md.length : idx + 1;
}

function extractSectionContentByOffsets(md: string, startOffset: number, endOffset: number): string {
  const start = Math.max(0, Math.min(md.length, startOffset));
  const end = Math.max(0, Math.min(md.length, endOffset));
  if (end <= start) return "";
  return md.slice(start, end).trim();
}

function extractNamedSections(content: string, tree: Root): Record<SectionName, string> {
  const out: Record<SectionName, string> = { system: "", rules: "", tools: "" };
  const rootChildren = Array.isArray(tree.children) ? tree.children : [];

  const headings = rootChildren
    .map((node, idx) => ({ node, idx }))
    .filter(({ node }) => isHeading(node))
    .map(({ node, idx }) => ({ node: node as Heading, idx }));

  function headingMatches(h: Heading, name: string): boolean {
    return normalizeHeadingText(toString(h)) === name;
  }

  const targets: Array<{ name: SectionName; label: string }> = [
    { name: "system", label: "system" },
    { name: "rules", label: "rules" },
    { name: "tools", label: "tools" },
  ];

  for (const target of targets) {
    const headingEntry = headings.find(({ node }) => node.depth === 2 && headingMatches(node, target.label));
    if (!headingEntry) continue;

    const heading = headingEntry.node;
    const headingEnd = heading.position?.end?.offset;
    const headingLineEnd = headingEnd === undefined ? undefined : advanceToNextLine(content, headingEnd);
    const startOffset = headingLineEnd ?? 0;

    const nextHeading = headings.find(({ idx, node }) => idx > headingEntry.idx && node.depth <= 2);
    const endOffset = nextHeading?.node.position?.start?.offset ?? content.length;

    out[target.name] = extractSectionContentByOffsets(content, startOffset, endOffset);
  }

  return out;
}

function extractTitleAndDescriptionFallbacks(tree: Root): { title?: string; description?: string } {
  const rootChildren = Array.isArray(tree.children) ? tree.children : [];
  const firstH1Index = rootChildren.findIndex((n) => isHeading(n) && (n as Heading).depth === 1);
  if (firstH1Index === -1) return {};

  const h1 = rootChildren[firstH1Index] as Heading;
  const title = toString(h1).trim();

  let description: string | undefined;
  for (let i = firstH1Index + 1; i < rootChildren.length; i++) {
    const n = rootChildren[i];
    if (isHeading(n)) break;
    if (isParagraph(n)) {
      const d = toString(n).trim();
      if (d) {
        description = d;
        break;
      }
    }
  }

  return { title: title || undefined, description };
}

export function parseAgentMdFromString(raw: string): AgentDefinition {
  const parsed = matter(raw, {
    engines: {
      yaml: (s) => YAML.parse(s),
    },
  });

  const frontmatterRaw = (parsed.data ?? {}) as Frontmatter;
  const fm = lowercaseKeysDeep(frontmatterRaw) as Frontmatter;

  const tree = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).parse(parsed.content) as Root;

  const { title: titleFallback, description: descriptionFallback } = extractTitleAndDescriptionFallbacks(tree);
  const sections = extractNamedSections(parsed.content, tree);

  const version = getString(fm.version) ?? AGENT_DEFINITION_DEFAULTS.version;
  const icon = getString(fm.icon) ?? AGENT_DEFINITION_DEFAULTS.icon;
  const title = getString(fm.title) ?? titleFallback ?? "";
  const description = getString(fm.description) ?? descriptionFallback ?? "";
  const status = getStatus(fm.status) ?? AGENT_DEFINITION_DEFAULTS.status;
  const templateEngine = getString(fm.templateengine) ?? AGENT_DEFINITION_DEFAULTS.templateEngine;
  const input = getString(fm.input) ?? AGENT_DEFINITION_DEFAULTS.input;
  const recommended = (isPlainObject(fm.recommended) ? (fm.recommended as Record<string, unknown>) : undefined) ?? {
    ...AGENT_DEFINITION_DEFAULTS.recommended,
  };
  const required = (isPlainObject(fm.required) ? (fm.required as Record<string, unknown>) : undefined) ?? {
    ...AGENT_DEFINITION_DEFAULTS.required,
  };
  const commands = getCommands(fm.commands) ?? [...AGENT_DEFINITION_DEFAULTS.commands];

  // Policy order:
  // 1) ## System
  // 2) description
  // 3) title
  const system = sections.system || description || title;

  return {
    version,
    icon,
    title,
    description,
    status,
    templateEngine,
    input,
    recommended,
    required,
    commands,
    system,
    rules: sections.rules || AGENT_DEFINITION_DEFAULTS.rules,
    toolsSource: sections.tools || AGENT_DEFINITION_DEFAULTS.toolsSource,
  };
}

export async function parseAgentMd(filePath: string): Promise<AgentDefinition> {
  const raw = await fs.readFile(filePath, "utf8");
  return parseAgentMdFromString(raw);
}

