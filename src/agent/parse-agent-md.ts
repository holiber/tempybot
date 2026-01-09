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

function normalizeComparableText(s: string): string {
  return s.trim().toLowerCase();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
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

function getStringStrict(opts: { key: string; v: unknown; allowEmpty?: boolean }): string | undefined {
  const { key, v, allowEmpty = false } = opts;
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new Error(`Invalid frontmatter '${key}': expected a string.`);
  }
  if (!allowEmpty && v.trim().length === 0) {
    throw new Error(`Invalid frontmatter '${key}': must be a non-empty string.`);
  }
  return v;
}

function getStatusStrict(v: unknown): AgentStatus | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new Error(`Invalid frontmatter 'status': expected a string (active | deprecated | disabled).`);
  }
  const s = v.toLowerCase().trim();
  if (s === "active" || s === "deprecated" || s === "disabled") return s;
  throw new Error(`Invalid frontmatter 'status': '${v}'. Expected active | deprecated | disabled.`);
}

function getCommandsStrict(v: unknown): AgentCommand[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) {
    throw new Error(`Invalid frontmatter 'commands': expected an array of strings or inline command objects.`);
  }
  if (v.length === 0) {
    throw new Error(`Invalid frontmatter 'commands': must not be an empty array (omit it or provide entries).`);
  }

  const out: AgentCommand[] = [];
  for (let i = 0; i < v.length; i++) {
    const item = v[i];
    if (typeof item === "string") {
      if (item.trim().length === 0) {
        throw new Error(`Invalid frontmatter 'commands[${i}]': string must be non-empty.`);
      }
      out.push(item);
      continue;
    }
    if (!isPlainObject(item)) {
      throw new Error(`Invalid frontmatter 'commands[${i}]': expected a string or an object.`);
    }

    const name = item.name;
    const description = item.description;
    const body = item.body;
    if (!isNonEmptyString(name)) {
      throw new Error(`Invalid frontmatter 'commands[${i}].name': expected a non-empty string.`);
    }
    if (!isNonEmptyString(description)) {
      throw new Error(`Invalid frontmatter 'commands[${i}].description': expected a non-empty string.`);
    }
    if (!isNonEmptyString(body)) {
      throw new Error(`Invalid frontmatter 'commands[${i}].body': expected a non-empty string.`);
    }

    const argumentHint = item["argument-hint"];
    if (argumentHint !== undefined) {
      if (typeof argumentHint === "string") {
        if (argumentHint.trim().length === 0) {
          throw new Error(`Invalid frontmatter 'commands[${i}].argument-hint': must be non-empty if provided.`);
        }
      } else if (Array.isArray(argumentHint)) {
        if (argumentHint.some((x) => typeof x !== "string" || x.trim().length === 0)) {
          throw new Error(
            `Invalid frontmatter 'commands[${i}].argument-hint': expected string[] of non-empty strings.`,
          );
        }
      } else {
        throw new Error(`Invalid frontmatter 'commands[${i}].argument-hint': expected a string or string[].`);
      }
    }

    out.push(item as AgentCommand);
  }
  return out;
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

function assertNoFrontmatterVsHeadingConflict(opts: {
  key: "title" | "description" | "system" | "rules";
  frontmatter: string | undefined;
  headingDerived: string | undefined;
}): void {
  const { key, frontmatter, headingDerived } = opts;
  if (!isNonEmptyString(frontmatter) || !isNonEmptyString(headingDerived)) return;

  if (normalizeComparableText(frontmatter) !== normalizeComparableText(headingDerived)) {
    throw new Error(
      `Conflicting '${key}' between YAML frontmatter and Markdown content. ` +
        `Frontmatter='${frontmatter.trim()}' vs Markdown='${headingDerived.trim()}'. ` +
        `Remove one or make them match (comparison is case-insensitive and trimmed).`,
    );
  }
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

  const fmVersion = getStringStrict({ key: "version", v: fm.version });
  const fmIcon = getStringStrict({ key: "icon", v: fm.icon });
  const fmTitle = getStringStrict({ key: "title", v: fm.title });
  const fmDescription = getStringStrict({ key: "description", v: fm.description, allowEmpty: true });
  const fmSystem = getStringStrict({ key: "system", v: fm.system, allowEmpty: true });
  const fmRules = getStringStrict({ key: "rules", v: fm.rules, allowEmpty: true });
  const fmTemplateEngine = getStringStrict({ key: "templateengine", v: fm.templateengine, allowEmpty: true });
  const fmInput = getStringStrict({ key: "input", v: fm.input, allowEmpty: true });
  const fmStatus = getStatusStrict(fm.status);

  assertNoFrontmatterVsHeadingConflict({ key: "title", frontmatter: fmTitle, headingDerived: titleFallback });
  assertNoFrontmatterVsHeadingConflict({
    key: "description",
    frontmatter: fmDescription,
    headingDerived: descriptionFallback,
  });
  // Only compare frontmatter vs explicit section content (not policy fallbacks).
  assertNoFrontmatterVsHeadingConflict({ key: "system", frontmatter: fmSystem, headingDerived: sections.system });
  assertNoFrontmatterVsHeadingConflict({ key: "rules", frontmatter: fmRules, headingDerived: sections.rules });

  const version = fmVersion ?? AGENT_DEFINITION_DEFAULTS.version;
  const icon = fmIcon ?? AGENT_DEFINITION_DEFAULTS.icon;
  const title = fmTitle ?? titleFallback ?? "";
  const description = fmDescription ?? descriptionFallback ?? "";
  const status = fmStatus ?? AGENT_DEFINITION_DEFAULTS.status;
  const templateEngine = fmTemplateEngine ?? AGENT_DEFINITION_DEFAULTS.templateEngine;
  const input = fmInput ?? AGENT_DEFINITION_DEFAULTS.input;
  const recommended = (isPlainObject(fm.recommended) ? (fm.recommended as Record<string, unknown>) : undefined) ?? {
    ...AGENT_DEFINITION_DEFAULTS.recommended,
  };
  const required = (isPlainObject(fm.required) ? (fm.required as Record<string, unknown>) : undefined) ?? {
    ...AGENT_DEFINITION_DEFAULTS.required,
  };
  if (fm.recommended !== undefined && !isPlainObject(fm.recommended)) {
    throw new Error(`Invalid frontmatter 'recommended': expected an object.`);
  }
  if (fm.required !== undefined && !isPlainObject(fm.required)) {
    throw new Error(`Invalid frontmatter 'required': expected an object.`);
  }

  const commands = getCommandsStrict(fm.commands) ?? [...AGENT_DEFINITION_DEFAULTS.commands];

  // Policy order:
  // 1) ## System
  // 2) description
  // 3) title
  const system = fmSystem || sections.system || description || title;

  const rules = fmRules ?? (sections.rules || AGENT_DEFINITION_DEFAULTS.rules);

  if (!isNonEmptyString(title)) {
    throw new Error(`Missing title. Provide '# <Title>' or YAML frontmatter 'title'.`);
  }

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
    rules,
    toolsSource: sections.tools || AGENT_DEFINITION_DEFAULTS.toolsSource,
  };
}

export async function parseAgentMd(filePath: string): Promise<AgentDefinition> {
  const raw = await fs.readFile(filePath, "utf8");
  return parseAgentMdFromString(raw);
}

